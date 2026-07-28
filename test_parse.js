import { parseYamlContent } from './src/utils/yamlParser.js';

const content = `trainer_name:
  # Your trainer name. If not set to choose_in_game, must be a name not exceeding 7 characters, and the prompt to name your character in-game will be skipped. See the setup guide on archipelago.gg for a list of allowed characters.
  choose_in_game: 50
`;

try {
  const result = parseYamlContent(content);
  console.log(JSON.stringify(result.settings, null, 2));
} catch(e) {
  console.error(e);
}
