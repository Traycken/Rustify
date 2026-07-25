@echo off
:: ====================================================================
:: Script d'automatisation du build Tauri
:: Contexte : Déploiement local / Intégration Continue (CI)
:: ====================================================================

echo [1/2] Installation des dependances Node.js...
call npm install
if %errorlevel% neq 0 (
    echo [ERREUR] L'installation des dependances a echoue.
    goto :error
)

echo [2/2] Lancement de la compilation Tauri...
call npm run tauri dev
if %errorlevel% neq 0 (
    echo [ERREUR] La compilation Tauri a echoue.
    goto :error
)

echo [SUCCES] Processus termine avec succes.
goto :end

:error
echo [FIN] Le processus s'est arrete suite a une erreur.

:end
:: Conserve la fenetre ouverte et l'invite de commandes active
cmd /k