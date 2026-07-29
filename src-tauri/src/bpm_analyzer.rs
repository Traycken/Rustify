use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use std::fs::File;
use std::path::Path;

/// Analyzes an audio file at `path` and estimates its tempo in Beats Per Minute (BPM).
/// Returns `Ok(f64)` with estimated BPM (e.g., 120.0 or 128.5) or an Error message.
pub fn detect_bpm<P: AsRef<Path>>(path: P) -> Result<f64, String> {
    let path_ref = path.as_ref();
    let file = File::open(path_ref).map_err(|e| format!("Failed to open file: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path_ref.extension().and_then(|s| s.to_str()) {
        hint.with_extension(ext);
    }

    let format_opts: FormatOptions = Default::default();
    let metadata_opts: MetadataOptions = Default::default();

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .map_err(|e| format!("Failed to probe audio format: {}", e))?;

    let mut format = probed.format;

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or_else(|| "No supported audio track found".to_string())?;

    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| "Unknown sample rate".to_string())? as f64;

    let decoder_opts: DecoderOptions = Default::default();
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &decoder_opts)
        .map_err(|e| format!("Failed to create audio decoder: {}", e))?;

    let track_id = track.id;

    // Collect mono samples (limit to max ~90 seconds of audio for efficiency & accuracy)
    let max_samples = (sample_rate * 90.0) as usize;
    let mut mono_samples: Vec<f32> = Vec::with_capacity(max_samples);

    while mono_samples.len() < max_samples {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(Error::IoError(_)) | Err(Error::ResetRequired) => break,
            Err(e) => return Err(format!("Error reading packet: {}", e)),
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(audio_buf) => {
                let spec = *audio_buf.spec();
                let num_channels = spec.channels.count();
                let num_frames = audio_buf.frames();
                if num_frames == 0 || num_channels == 0 {
                    continue;
                }

                let mut sample_buf = symphonia::core::audio::SampleBuffer::<f32>::new(
                    audio_buf.capacity() as u64,
                    spec,
                );
                sample_buf.copy_interleaved_ref(audio_buf);
                let samples = sample_buf.samples();

                for frame in samples.chunks(num_channels) {
                    let mono: f32 = frame.iter().sum::<f32>() / (num_channels as f32);
                    mono_samples.push(mono);
                    if mono_samples.len() >= max_samples {
                        break;
                    }
                }
            }
            Err(Error::DecodeError(_)) => continue,
            Err(_) => break,
        }
    }

    if mono_samples.len() < (sample_rate * 5.0) as usize {
        return Err("Audio track too short for BPM analysis (minimum 5 seconds required)".to_string());
    }

    // Downsample if rate is high to ~11025 Hz for fast onset computation
    let target_sr = 11025.0;
    let decimation_factor = (sample_rate / target_sr).round().max(1.0) as usize;
    let effective_sr = sample_rate / (decimation_factor as f64);

    let downsampled: Vec<f32> = mono_samples
        .chunks(decimation_factor)
        .map(|chunk| chunk[0])
        .collect();

    // Compute energy onset envelope
    let hop_size = 256; // ~23.2ms per frame at 11025Hz (~43 frames/sec)
    let frame_rate = effective_sr / (hop_size as f64);

    let energy_envelope: Vec<f32> = downsampled

        .chunks(hop_size)
        .map(|chunk| {
            let sum_sq: f32 = chunk.iter().map(|&s| s * s).sum();
            (sum_sq / (chunk.len() as f32)).sqrt()
        })
        .collect();

    if energy_envelope.len() < 100 {
        return Err("Insufficient audio frames after processing".to_string());
    }

    // Rectified energy derivative (onset strength signal)
    let mut onset: Vec<f32> = Vec::with_capacity(energy_envelope.len());
    onset.push(0.0);
    for i in 1..energy_envelope.len() {
        let diff = energy_envelope[i] - energy_envelope[i - 1];
        onset.push(if diff > 0.0 { diff } else { 0.0 });
    }

    // Normalize onset signal
    let max_onset = onset.iter().cloned().fold(0.0_f32, f32::max);
    if max_onset > 0.0 {
        for v in onset.iter_mut() {
            *v /= max_onset;
        }
    }

    // Autocorrelation for BPM search range: 60 to 180 BPM
    let min_bpm = 60.0;
    let max_bpm = 180.0;

    let min_lag = ((60.0 * frame_rate) / max_bpm).floor() as usize;
    let max_lag = ((60.0 * frame_rate) / min_bpm).ceil() as usize;

    let n = onset.len();
    if n <= max_lag {
        return Err("Onset signal too short for target BPM range".to_string());
    }

    let mut best_lag = min_lag;
    let mut max_corr = -1.0_f32;
    let mut correlations = vec![0.0_f32; max_lag + 2];

    for lag in min_lag..=max_lag {
        let mut sum = 0.0_f32;
        let limit = n - lag;
        for i in 0..limit {
            sum += onset[i] * onset[i + lag];
        }
        let norm_corr = sum / (limit as f32);
        correlations[lag] = norm_corr;
        if norm_corr > max_corr {
            max_corr = norm_corr;
            best_lag = lag;
        }
    }

    if max_corr <= 0.0 || best_lag == 0 {
        return Err("Could not detect clear tempo periodicity".to_string());
    }

    // Parabolic interpolation around peak lag for finer precision
    let mut precise_lag = best_lag as f64;
    if best_lag > min_lag && best_lag < max_lag {
        let y1 = correlations[best_lag - 1] as f64;
        let y2 = correlations[best_lag] as f64;
        let y3 = correlations[best_lag + 1] as f64;
        let denom = 2.0 * (2.0 * y2 - y1 - y3);
        if denom.abs() > 1e-6 {
            let delta = (y1 - y3) / denom;
            if delta.abs() < 1.0 {
                precise_lag += delta;
            }
        }
    }

    let mut estimated_bpm = (60.0 * frame_rate) / precise_lag;

    // Disambiguate harmonic octave errors if bpm is out of typical range (< 70 or > 160)
    if estimated_bpm < 70.0 {
        estimated_bpm *= 2.0;
    } else if estimated_bpm > 165.0 {
        estimated_bpm /= 2.0;
    }

    // Round to 1 decimal place
    let rounded_bpm = (estimated_bpm * 10.0).round() / 10.0;
    Ok(rounded_bpm)
}
