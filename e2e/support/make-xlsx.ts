// Runs in plain Node (type stripping): builds a synthetic BBVA file from JSON on stdin, prints it as base64.
import { bbvaXlsx } from '../../test/support/bbvaXlsx.ts';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { movements, options } = JSON.parse(input);
process.stdout.write(Buffer.from(await bbvaXlsx(movements, options)).toString('base64'));
