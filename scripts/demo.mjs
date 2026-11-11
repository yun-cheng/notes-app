// Loads the TypeScript seed through Vite, so it can reuse the app's own crypto and types.
import { runnerImport } from 'vite';

const { module } = await runnerImport('./scripts/demoData.ts', { configFile: false, logLevel: 'error' });
const { cards, pin, recoveryKey } = await module.seed();
console.log(`Demo ready: ${cards} cards for "Demo", plus a vault shared with "Sam".`);
console.log('Open http://localhost:5191/demo with `npm run dev` running.');
console.log(`The Private vault's PIN is ${pin}; its recovery key is ${recoveryKey}.`);
