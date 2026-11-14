// Loads the TypeScript seed through Vite, so it can reuse the app's own crypto and types.
import { runnerImport } from 'vite';

const { module } = await runnerImport('./scripts/demoData.ts', { configFile: false, logLevel: 'error' });
const { cards, pin, recoveryKey, diaryOpen } = await module.seed();
console.log(`Demo ready: ${cards} cards for "Demo", plus a vault shared with "Sam". Anything else in the accounts was kept.`);
console.log('Open http://localhost:5191/demo with `npm run dev` running.');
if (!diaryOpen) console.log(`The Diary vault's PIN is no longer ${pin}, so it was left as it is, without the demo's entries.`);
else console.log(`The Diary vault's PIN is ${pin}${recoveryKey ? `; its recovery key is ${recoveryKey}` : ''}.`);
