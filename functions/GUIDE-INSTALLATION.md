# Robot Drive — installation (une seule fois, sur ordinateur)

Ce que fait le robot : chaque nouvelle facture est copiée dans ton Google Drive, et chaque nuit à 3 h (Tahiti) il met à jour le suivi (élèves, abonnés, professeurs, paiements) et rattrape les anciennes factures (25 par nuit).
Il crée lui-même, dans ton Drive, un dossier **« MF Harmonie – suivi automatique »** avec : `Factures/année/mois`, `Suivi/`, et `dernier-envoi.json` (pour que Claude vérifie que tout marche).

## Avant de commencer
- Un ordinateur avec Chrome, connecté au compte Google du projet Firebase (mf-harmonie-des-iles).
- La formule Blaze est déjà active (OK).

## Étape 1 — Autoriser l'accès à ton Drive (Google Cloud)
1. console.cloud.google.com, projet **mf-harmonie-des-iles**.
2. « API et services » → « Bibliothèque » → cherche **Google Drive API** → **Activer**.
3. « API et services » → « Écran de consentement OAuth » : type **Externe**, nom « MF Harmonie robot », ton e-mail. Scope à ajouter : `.../auth/drive.file`. Ajoute ton e-mail en « utilisateur test ».
4. **Important :** sur cet écran, clique **« Publier l'application »** (statut « En production »). Sans ça, l'autorisation expire au bout de 7 jours.
5. « Identifiants » → « Créer des identifiants » → **ID client OAuth** → type **Application Web**. URI de redirection autorisé : `https://developers.google.com/oauthplayground`. Note l'**ID client** et le **code secret**.

## Étape 2 — Obtenir la clé de ton Drive
1. Ouvre developers.google.com/oauthplayground.
2. Roue dentée (en haut à droite) → coche « Use your own OAuth credentials » → colle l'ID client et le code secret.
3. À gauche, dans la zone de saisie, écris `https://www.googleapis.com/auth/drive.file` → « Authorize APIs » → choisis mf.harmoniedesiles@gmail.com → Autoriser.
4. Clique « Exchange authorization code for tokens » → copie le **Refresh token**.

## Étape 3 — Installer le robot
Dans un terminal, dans le dossier du site (mf-harmonie) :
```
npm install -g firebase-tools
firebase login
cd functions && npm install && cd ..
firebase functions:secrets:set DRIVE_CLIENT_ID
firebase functions:secrets:set DRIVE_CLIENT_SECRET
firebase functions:secrets:set DRIVE_REFRESH_TOKEN
firebase deploy --only functions
```
(Chaque commande « secrets:set » te demande de coller la valeur.)

## Étape 4 — Alerte de budget (recommandé)
Console Google Cloud → « Facturation » → « Budgets et alertes » → budget de 5 € avec alerte par e-mail.

## Vérifier
Demande à Claude : « Regarde dans mon Drive si le robot a bien envoyé les factures ». Il lira `dernier-envoi.json`.

## Arrêter le robot
`firebase functions:delete factureVersDrive suiviNocturne --region us-central1`
