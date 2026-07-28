const fs = require('fs');
const YAML = require('yaml');

const basePath = 'C:/ProgramData/Archipelago/host.yaml';
const friendPath = 'C:/Users/flipp/Downloads/host.yaml';

const baseYaml = fs.readFileSync(basePath, 'utf8');
const friendYaml = fs.readFileSync(friendPath, 'utf8');

const baseDoc = YAML.parseDocument(baseYaml);
const friendDoc = YAML.parseDocument(friendYaml);

const baseObj = baseDoc.toJS();
const friendObj = friendDoc.toJS();

// Recursively merge friendObj into baseDoc while keeping base-only keys and adding friend-only keys
function mergeDocs(baseDoc, friendObj) {
  for (const [key, value] of Object.entries(friendObj)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      if (!baseDoc.has(key)) {
        baseDoc.set(key, value);
      } else {
        const subNode = baseDoc.get(key);
        if (subNode && typeof subNode === 'object') {
          for (const [subKey, subVal] of Object.entries(value)) {
            // Replace locky with flipp in file paths if applicable
            let finalVal = subVal;
            if (typeof finalVal === 'string' && finalVal.includes('C:/Users/locky') || (typeof finalVal === 'string' && finalVal.includes('C:\\Users\\locky'))) {
              finalVal = finalVal.replace(/C:[\/\\]Users[\/\\]locky/gi, 'C:/Users/flipp');
            }
            baseDoc.setIn([key, subKey], finalVal);
          }
        }
      }
    } else {
      let finalVal = value;
      if (typeof finalVal === 'string' && (finalVal.includes('C:/Users/locky') || finalVal.includes('C:\\Users\\locky'))) {
        finalVal = finalVal.replace(/C:[\/\\]Users[\/\\]locky/gi, 'C:/Users/flipp');
      }
      baseDoc.set(key, finalVal);
    }
  }
}

mergeDocs(baseDoc, friendObj);

const mergedYaml = baseDoc.toString();
fs.writeFileSync('C:/Users/flipp/Downloads/host_merged.yaml', mergedYaml, 'utf8');
console.log("Successfully generated host_merged.yaml");
