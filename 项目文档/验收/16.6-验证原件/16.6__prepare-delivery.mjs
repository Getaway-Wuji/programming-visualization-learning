import fs from 'node:fs';
fs.writeFileSync('.artifacts/16.6/relocate-compatibility.mjs',fs.readFileSync('.artifacts/16.5/relocate-compatibility.mjs','utf8').replaceAll('16.5','16.6').replaceAll('r165-','r166-').replace("['16.2','16.3','16.4']","['16.2','16.3','16.4','16.5']"));
