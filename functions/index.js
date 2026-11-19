/* MF Harmonie — « robot Drive »
   1) À chaque facture enregistrée dans Firebase : le PDF est copié dans Google Drive (Factures / année / mois).
   2) Chaque nuit à 3 h (heure de Tahiti) : rattrape les anciennes factures pas encore envoyées (25 max par nuit)
      et met à jour le suivi (élèves, abonnés, professeurs, paiements) + un fichier « dernier-envoi.json » pour vérifier.
   Les mots de passe / codes d'accès ne sont jamais envoyés. */
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { google } = require('googleapis');
const { Readable } = require('stream');

admin.initializeApp();
const db = admin.firestore();

const CLIENT_ID = defineSecret('DRIVE_CLIENT_ID');
const CLIENT_SECRET = defineSecret('DRIVE_CLIENT_SECRET');
const REFRESH_TOKEN = defineSecret('DRIVE_REFRESH_TOKEN');
const SECRETS = [CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN];
const REGION = 'us-central1';
const DOSSIER_RACINE = 'MF Harmonie – suivi automatique';
const MOIS = ['01-Janvier','02-Février','03-Mars','04-Avril','05-Mai','06-Juin','07-Juillet','08-Août','09-Septembre','10-Octobre','11-Novembre','12-Décembre'];
const SECRET_RE = /mdp|mot.?de.?passe|password|passwd|^code|pin$|secret|token/i;

function getDrive() {
  const auth = new google.auth.OAuth2(CLIENT_ID.value(), CLIENT_SECRET.value());
  auth.setCredentials({ refresh_token: REFRESH_TOKEN.value() });
  return google.drive({ version: 'v3', auth });
}
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const cacheDossiers = new Map();
async function dossier(drive, nom, parentId) {
  const cle = parentId + '/' + nom;
  if (cacheDossiers.has(cle)) return cacheDossiers.get(cle);
  const r = await drive.files.list({
    q: `name='${q(nom)}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id)', pageSize: 1,
  });
  let id = r.data.files && r.data.files[0] && r.data.files[0].id;
  if (!id) {
    const c = await drive.files.create({ requestBody: { name: nom, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }, fields: 'id' });
    id = c.data.id;
  }
  cacheDossiers.set(cle, id);
  return id;
}
async function cheminDossiers(drive, segments) {
  let parent = await dossier(drive, DOSSIER_RACINE, 'root');
  for (const s of segments) parent = await dossier(drive, s, parent);
  return parent;
}
// Crée le fichier, ou le remplace s'il existe déjà (pas de doublon)
async function deposer(drive, parentId, nom, mimeType, contenu) {
  const r = await drive.files.list({ q: `name='${q(nom)}' and '${parentId}' in parents and trashed=false`, fields: 'files(id)', pageSize: 1 });
  const existant = r.data.files && r.data.files[0];
  const media = { mimeType, body: Readable.from(Buffer.isBuffer(contenu) ? contenu : Buffer.from(contenu)) };
  if (existant) { const u = await drive.files.update({ fileId: existant.id, media, fields: 'id' }); return u.data.id; }
  const c = await drive.files.create({ requestBody: { name: nom, parents: [parentId] }, media, fields: 'id' });
  return c.data.id;
}

async function envoyerFacture(drive, id, x) {
  if (!x || !x.chemin || x.annulee || x.driveId) return false;
  const [buf] = await admin.storage().bucket().file(x.chemin).download();
  const annee = String(x.annee || (x.moisKey || '').slice(0, 4) || 'Sans-annee');
  const m = parseInt(String(x.moisKey || '').slice(5, 7), 10);
  const segs = ['Factures', annee].concat(m >= 1 && m <= 12 ? [MOIS[m - 1]] : []);
  const parent = await cheminDossiers(drive, segs);
  const nom = String(x.chemin).split('/').pop();
  const driveId = await deposer(drive, parent, nom, 'application/pdf', buf);
  await db.collection('factures').doc(id).set({ driveId, driveEnvoyeLe: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return true;
}

// 1) Chaque nouvelle facture → Drive
exports.factureVersDrive = onDocumentWritten(
  { document: 'factures/{id}', region: REGION, secrets: SECRETS, timeoutSeconds: 120, memory: '512MiB' },
  async (event) => {
    const apres = event.data && event.data.after && event.data.after.data();
    if (!apres) return;
    await envoyerFacture(getDrive(), event.params.id, apres);
  }
);

function nettoyer(v) {
  if (v && typeof v.toDate === 'function') { try { return v.toDate().toISOString(); } catch (e) { return ''; } }
  if (Array.isArray(v)) return v.map(nettoyer);
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach((k) => { if (!SECRET_RE.test(k)) o[k] = nettoyer(v[k]); }); return o; }
  return v;
}

// 2) Chaque nuit : rattrapage des anciennes factures + suivi
exports.suiviNocturne = onSchedule(
  { schedule: '0 3 * * *', timeZone: 'Pacific/Tahiti', region: REGION, secrets: SECRETS, timeoutSeconds: 540, memory: '1GiB' },
  async () => {
    const drive = getDrive();
    const bilan = { date: new Date().toISOString(), facturesRattrapees: 0, facturesEnErreur: [], suivi: {} };
    const snap = await db.collection('factures').get();
    const aFaire = snap.docs.filter((d) => { const x = d.data(); return x.chemin && !x.annulee && !x.driveId; }).slice(0, 25);
    for (const d of aFaire) {
      try { if (await envoyerFacture(drive, d.id, d.data())) bilan.facturesRattrapees++; }
      catch (e) { bilan.facturesEnErreur.push(d.id + ' : ' + (e && e.message)); }
    }
    bilan.facturesRestantes = snap.docs.filter((d) => { const x = d.data(); return x.chemin && !x.annulee && !x.driveId; }).length - bilan.facturesRattrapees;
    const dossierSuivi = await cheminDossiers(drive, ['Suivi']);
    for (const nom of ['eleves', 'abonnes', 'profs', 'paiements']) {
      try {
        const s = await db.collection(nom).get();
        const liste = s.docs.map((d) => Object.assign(nettoyer(d.data()), { _id: d.id }));
        await deposer(drive, dossierSuivi, nom + '.json', 'application/json', JSON.stringify(liste, null, 1));
        bilan.suivi[nom] = liste.length;
      } catch (e) { bilan.suivi[nom] = 'erreur : ' + (e && e.message); }
    }
    await deposer(drive, await cheminDossiers(drive, []), 'dernier-envoi.json', 'application/json', JSON.stringify(bilan, null, 1));
  }
);
