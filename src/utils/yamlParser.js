import YAML from 'yaml'

export function parseTemplate(rawYaml) {
  const lines = rawYaml.split(/\r?\n/);

  // Extract top-level info
  let doc
  try {
    doc = YAML.parse(rawYaml);
  } catch (e) {
    return null;
  }
  
  if (!doc) return null;

  const gameName = doc.game;
  if (!gameName) return null;
  
  const name = doc.name || 'Player{number}';
  const description = doc.description || '';
  const requires = doc.requires || {};
  const gameSettings = doc[gameName];
  if (!gameSettings) return null;

  // Now parse line-by-line to extract comments, groups, and setting metadata
  const settings = [];
  let currentGroup = 'General';
  let inGameBlock = false;
  let currentSetting = null;
  let commentBuffer = [];
  let settingIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect game block start (e.g., "A Short Hike:")
    if (!inGameBlock) {
      if (trimmed === `${gameName}:`) {
        inGameBlock = true;
      }
      continue;
    }

    // Detect group headers like  ################
    //                            # Game Options #
    //                            ################
    const groupMatch = trimmed.match(/^#\s+(.+?)\s+#$/);
    if (groupMatch && !trimmed.startsWith('# #')) {
      const potentialGroup = groupMatch[1].trim();
      // Only accept if it looks like a section header (surrounded by ### lines)
      if (potentialGroup && !potentialGroup.startsWith('Q.') && !potentialGroup.startsWith('A.')) {
        // Finalize any in-progress setting before changing groups
        if (currentSetting) {
          settings.push(finalizeSetting(currentSetting));
          currentSetting = null;
        }
        currentGroup = potentialGroup;
        commentBuffer = [];
        continue;
      }
    }

    // Skip pure decoration lines
    if (/^#{3,}$/.test(trimmed)) {
      continue;
    }

    // Collect comment lines
    if (trimmed.startsWith('#')) {
      const commentText = trimmed.replace(/^#\s?/, '');
      // If we're inside a setting, check if this comment is at a deeper indent
      if (currentSetting) {
        const commentIndentMatch = line.match(/^(\s+)/);
        const commentIndent = commentIndentMatch ? commentIndentMatch[1].length : 0;
        if (commentIndent > settingIndent) {
          // This comment belongs to the current setting (describes its options)
          currentSetting.rawLines.push(line);
          continue;
        }
        // Otherwise this is a comment at the setting level — belongs to the NEXT setting
        // First, save the current setting
        settings.push(finalizeSetting(currentSetting));
        currentSetting = null;
      }
      commentBuffer.push(commentText);
      continue;
    }

    // Empty line
    if (trimmed === '') {
      continue;
    }

    // Detect a setting key at the game-settings indentation level (typically 2 spaces)
    const indentMatch = line.match(/^(\s+)/);
    const indent = indentMatch ? indentMatch[1].length : 0;

    // First real key tells us the setting indent level
    if (settingIndent === -1 && indent > 0 && !trimmed.startsWith('#')) {
      settingIndent = indent;
    }

    if (indent === settingIndent && trimmed.includes(':')) {
      // Save previous setting
      if (currentSetting) {
        settings.push(finalizeSetting(currentSetting));
      }

      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.substring(0, colonIdx).trim();
      const valueAfterColon = trimmed.substring(colonIdx + 1).trim();

      currentSetting = {
        key,
        group: currentGroup,
        description: commentBuffer.join('\n'),
        type: null, // will be determined
        options: [],  // for choice/weighted
        min: null,
        max: null,
        defaultValue: null,
        inlineValue: valueAfterColon,
        rawLines: [],
      };
      commentBuffer = [];

      // If value is on the same line, it's a simple scalar
      if (valueAfterColon !== '' && valueAfterColon !== '|' && valueAfterColon !== '>') {
        // Could be [], {}, or a scalar
        if (valueAfterColon === '[]') {
          currentSetting.type = 'list';
          currentSetting.defaultValue = [];
        } else if (valueAfterColon === '{}') {
          currentSetting.type = 'dict';
          currentSetting.defaultValue = {};
        } else {
          currentSetting.type = 'scalar';
          currentSetting.defaultValue = valueAfterColon;
        }
      }
    } else if (currentSetting && indent > settingIndent) {
      // Sub-lines of the current setting
      currentSetting.rawLines.push(line);
    }
  }

  // Push the last setting
  if (currentSetting) {
    settings.push(finalizeSetting(currentSetting));
  }

  return {
    gameName,
    name,
    description,
    requires,
    settings,
  };
}

function finalizeSetting(setting) {
  const { key, rawLines, inlineValue } = setting;

  // Extract leading comment lines from rawLines as the description
  // (comments between the setting key and its options)
  const descriptionParts = [];
  let nonCommentStart = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const t = rawLines[i].trim();
    if (t.startsWith('#')) {
      descriptionParts.push(t.replace(/^#\s?/, ''));
      nonCommentStart = i + 1;
    } else if (t === '') {
      nonCommentStart = i + 1;
    } else {
      break;
    }
  }
  if (descriptionParts.length > 0 && !setting.description) {
    setting.description = descriptionParts.join('\n');
  } else if (descriptionParts.length > 0) {
    setting.description = setting.description + '\n' + descriptionParts.join('\n');
  }
  // Remove the leading comments from rawLines so they aren't parsed as options
  if (nonCommentStart > 0) {
    rawLines.splice(0, nonCommentStart);
  }

  // Extract candidate items/dicts from comments
  const { candidateItems, candidateDict } = extractCandidatesFromComments(setting.description, setting.key);
  if (candidateItems && candidateItems.length > 0) {
    setting.candidateItems = candidateItems;
  }
  if (candidateDict && Object.keys(candidateDict).length > 0) {
    setting.candidateDict = candidateDict;
  }

  // Extract example YAML block if present in comments
  const exampleYaml = extractExampleYaml(setting.description);
  setting.exampleYaml = exampleYaml;
  if (exampleYaml && setting.candidateItems) {
    const proseTerms = ['arrival side', 'entrance', 'exit', 'direction'];
    if (setting.candidateItems.some(c => proseTerms.includes(String(c).toLowerCase()))) {
      setting.candidateItems = null;
    }
  }

  // Ensure default list items are included in candidateItems
  if (Array.isArray(setting.defaultValue) && setting.defaultValue.length > 0) {
    if (!setting.candidateItems) {
      setting.candidateItems = [];
    }
    for (const item of setting.defaultValue) {
      const itemStr = String(item);
      if (!setting.candidateItems.includes(itemStr)) {
        setting.candidateItems.push(itemStr);
      }
    }
  }

  // If type was already determined (scalar, list, dict from inline)
  if (setting.type === 'scalar') {
    return cleanSetting(setting);
  }

  if (setting.type === 'list' || setting.type === 'dict') {
    // Check if there are sub-lines that give list items
    if (rawLines.length > 0) {
      const items = [];
      for (const rl of rawLines) {
        const t = rl.trim();
        if (t.startsWith('- ')) {
          items.push(t.substring(2).trim());
        } else if (t.startsWith('#')) {
          // skip comments within list
        }
      }
      if (items.length > 0) {
        setting.type = 'list';
        setting.defaultValue = items;
      }
    }
    return cleanSetting(setting);
  }

  // Parse sub-lines to determine type
  if (rawLines.length === 0 && inlineValue === '') {
    setting.type = 'scalar';
    setting.defaultValue = '';
    return cleanSetting(setting);
  }

  // Check for inline arrays or dicts in rawLines, e.g. `['Ironclad', 'Silent']`
  for (const rl of rawLines) {
    const t = rl.trim();
    if (t.startsWith('[') && t.endsWith(']')) {
      setting.type = 'list';
      try {
        // Try parsing the inline array via YAML parser
        const parsed = YAML.parse(t);
        setting.defaultValue = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        setting.defaultValue = [];
      }
      return cleanSetting(setting);
    }
    if (t.startsWith('{') && t.endsWith('}')) {
      setting.type = 'dict';
      try {
        const parsed = YAML.parse(t);
        setting.defaultValue = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
      } catch (e) {
        setting.defaultValue = {};
      }
      return cleanSetting(setting);
    }
  }

  // Check for list with - items
  const listItems = [];
  const dictItems = {};
  const choiceOptions = [];
  let hasListItems = false;
  let hasDictItems = false;
  let hasChoiceItems = false;

  // Parse description for min/max hints
  const minMatch = setting.description?.match(/Minimum value is (-?\d+)/);
  const maxMatch = setting.description?.match(/Maximum value is (-?\d+)/);
  if (minMatch) setting.min = parseInt(minMatch[1]);
  if (maxMatch) setting.max = parseInt(maxMatch[1]);

  for (const rl of rawLines) {
    const t = rl.trim();

    // Skip comment lines
    if (t.startsWith('#')) continue;

    // List item
    if (t.startsWith('- ')) {
      hasListItems = true;
      listItems.push(t.substring(2).trim());
      continue;
    }

    // Key-value pair (choice option or dict)
    const kvMatch = t.match(/^(.+?):\s*(.*)$/);
    if (kvMatch) {
      let optKey = kvMatch[1].trim().replace(/^'(.*)'$/, '$1');
      let optVal = kvMatch[2].trim();

      // Remove inline comments for the weight value
      const commentIdx = optVal.indexOf('#');
      let inlineComment = '';
      if (commentIdx !== -1) {
        inlineComment = optVal.substring(commentIdx + 1).trim();
        optVal = optVal.substring(0, commentIdx).trim();
      }

      const numVal = parseInt(optVal);
      if (!isNaN(numVal) || optVal === '') {
        hasChoiceItems = true;
        choiceOptions.push({
          value: optKey,
          weight: isNaN(numVal) ? 0 : numVal,
          comment: inlineComment,
        });
      } else {
        // It's a dict entry
        hasDictItems = true;
        dictItems[optKey] = optVal;
      }
    }
  }

  if (hasListItems && !hasChoiceItems) {
    setting.type = 'list';
    setting.defaultValue = listItems;
  } else if (hasDictItems && !hasChoiceItems) {
    setting.type = 'dict';
    setting.defaultValue = dictItems;
  } else if (hasChoiceItems) {
    const lowerKey = setting.key.toLowerCase();
    const isWeightedName = lowerKey.includes('weights') || lowerKey.includes('distribution') || lowerKey.endsWith('_plando') || lowerKey.endsWith('_inventory') || lowerKey.endsWith('_overrides') || lowerKey === 'game_options' || lowerKey.endsWith('_options');
    const hasCandidateDict = setting.candidateDict && Object.keys(setting.candidateDict).length > 0;
    const nonZeroCount = choiceOptions.filter(o => !String(o.value).startsWith('random') && o.weight > 0).length;
    const allZero = choiceOptions.length > 1 && choiceOptions.every(o => o.weight === 0);
    const isDictMap = isWeightedName || hasCandidateDict || allZero || nonZeroCount > 1;

    if (isDictMap) {
      setting.type = 'dict';
      setting.isHybridSet = true;
      const dictObj = {};
      for (const opt of choiceOptions) {
        dictObj[opt.value] = opt.weight;
      }
      try {
        const minIndent = rawLines.reduce((min, line) => {
          if (line.trim() === '') return min;
          const indent = line.match(/^\s*/)[0].length;
          return Math.min(min, indent);
        }, Infinity);
        const unindentedLines = minIndent !== Infinity 
          ? rawLines.map(line => line.substring(minIndent))
          : rawLines;
        const parsedBlock = YAML.parse(unindentedLines.join('\n'));
        if (parsedBlock && typeof parsedBlock === 'object') {
          setting.defaultValue = parsedBlock;
        } else {
          setting.defaultValue = dictObj;
        }
      } catch (e) {
        setting.defaultValue = dictObj;
      }
      setting.options = choiceOptions;
      if (!setting.candidateItems && Object.keys(dictObj).length > 0) {
        setting.candidateItems = Object.keys(dictObj);
      }
    } else {
      // Determine if it's a range or choice type
      const isRange = setting.min !== null && setting.max !== null;

      if (isRange) {
        setting.type = 'range';
        // Find the default value (highest weight among non-random options)
        const nonRandom = choiceOptions.filter(o => !String(o.value).startsWith('random'));
        if (nonRandom.length > 0) {
          const best = nonRandom.reduce((a, b) => (b.weight > a.weight ? b : a));
          setting.defaultValue = best.value;
        }
      } else {
        setting.type = 'choice';
      }

      setting.options = choiceOptions;
      if (choiceOptions.length > 0) {
        const optKeys = choiceOptions
          .map(o => String(o.value))
          .filter(v => !v.startsWith('random'));
        if (optKeys.length > 0) {
          setting.candidateItems = [...optKeys];
        }
      }
    }
  } else {
    setting.type = 'scalar';
    setting.defaultValue = inlineValue || '';
  }

  if (setting.defaultValue && typeof setting.defaultValue === 'object' && !Array.isArray(setting.defaultValue)) {
    const dictKeys = Object.keys(setting.defaultValue);
    if (dictKeys.length > 0) {
      if (!setting.candidateItems) {
        setting.candidateItems = [];
      }
      for (const k of dictKeys) {
        if (!setting.candidateItems.includes(k)) {
          setting.candidateItems.push(k);
        }
      }
    }
  }

  // Ensure default list items are included in candidateItems
  if (Array.isArray(setting.defaultValue) && setting.defaultValue.length > 0) {
    if (!setting.candidateItems) {
      setting.candidateItems = [];
    }
    for (const item of setting.defaultValue) {
      const itemStr = String(item);
      if (!setting.candidateItems.includes(itemStr)) {
        setting.candidateItems.push(itemStr);
      }
    }
  }

function normalizeKey(str) {
  if (str === false) return 'false';
  if (str === true) return 'true';
  return String(str ?? '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .replace(/\b(?:random|randomize|and|or|the|of)\b/gi, '')
    .replace(/\s+/g, '');
}

  // Ensure candidate items are included in setting options (only if setting.options has < 2 choices)
  if ((setting.type === 'choice' || setting.type === 'range' || setting.options) && setting.candidateItems && setting.candidateItems.length > 0) {
    // Clean candidateItems
    setting.candidateItems = setting.candidateItems
      .map(c => String(c).replace(/[*_~`]+/g, '').replace(/\s*\([^)]*\)/g, '').trim())
      .filter(c => c && !c.toLowerCase().includes('teleporter name') && !c.toLowerCase().includes('possible values'));

    if (!setting.options) {
      setting.options = [];
    }
    const isBooleanChoice = setting.options.length > 0 && setting.options.every(o => ['false', 'true', 'off', 'on'].includes(String(o.value).toLowerCase()));
    const nonRandomOptions = setting.options.filter(o => !String(o.value).startsWith('random'));

    if (!isBooleanChoice && nonRandomOptions.length < 2) {
      const existingValSet = new Set(setting.options.map(o => normalizeKey(o.value)));
      for (const cand of setting.candidateItems) {
        const candStr = String(cand).trim();
        const normCand = normalizeKey(candStr);
        if (candStr && !candStr.startsWith('random') && normCand && !existingValSet.has(normCand)) {
          setting.options.push({
            value: candStr,
            weight: 0,
            comment: '',
          });
          existingValSet.add(normCand);
        }
      }
    }
  }

  // Extract example YAML block if present in comments
  setting.exampleYaml = extractExampleYaml(setting.description, setting.key);

  return cleanSetting(setting);
}

function extractExampleYaml(description) {
  if (!description) return null;
  const lines = description.split('\n');
  let inExample = false;
  const exampleLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.toLowerCase().startsWith('example')) {
      inExample = true;
      continue;
    }

    if (inExample) {
      if (trimmed.startsWith('-') || trimmed.includes(':') || line.startsWith('  ') || line.startsWith('\t')) {
        if (!trimmed.toLowerCase().startsWith('to pin') && !trimmed.toLowerCase().startsWith('note')) {
          exampleLines.push(line);
        } else if (exampleLines.length > 0) {
          break;
        }
      } else if (exampleLines.length > 0 && trimmed !== '') {
        break;
      }
    }
  }

  if (exampleLines.length > 0) {
    const split = exampleLines.filter(l => l.trim() !== '');
    if (split.length > 0 && split[0].trim().endsWith(':') && !split[0].trim().startsWith('-')) {
      split.shift(); // strip header line like "plando_connections:"
    }
    if (split.length > 0) {
      let minIndent = Infinity;
      for (const line of split) {
        if (line.trim() === '') continue;
        const match = line.match(/^([ \t]*)/);
        const indentLen = match ? match[1].length : 0;
        if (indentLen < minIndent) {
          minIndent = indentLen;
        }
      }

      if (minIndent !== Infinity && minIndent > 0) {
        const regex = new RegExp(`^[ \\t]{1,${minIndent}}`);
        return split.map(l => l.replace(regex, '')).join('\n').trim();
      }
      return split.join('\n').trim();
    }
  }
  return null;
}

function extractCandidatesFromComments(description, settingKey) {
  if (!description) return { candidateItems: null, candidateDict: null };

  let candidateItems = null;
  let candidateDict = null;

  // Extract sub-option dict maps like "battle_animations: all/no_scene/no_bars/speedy - Sets which..."
  const subOptionMap = {};
  const descLines = description.split('\n');
  for (const l of descLines) {
    const trimmed = l.trim();
    const subOptMatch = trimmed.match(/^([A-Za-z0-9_]+):\s*([A-Za-z0-9_/\-\s]+?)\s*-\s+(.+)$/);
    if (subOptMatch) {
      const subKey = subOptMatch[1].trim();
      const valsStr = subOptMatch[2].trim();
      if (valsStr.includes('/')) {
        const choices = valsStr.split('/').map(v => v.trim()).filter(Boolean);
        if (choices.length > 0) {
          subOptionMap[subKey] = choices;
        }
      }
    }
  }
  if (Object.keys(subOptionMap).length > 0) {
    candidateDict = subOptionMap;
  }

  // 1. Look for bracketed array substring [...] in description
  let startIdx = description.indexOf('[');
  while (startIdx !== -1) {
    let endIdx = description.indexOf(']', startIdx);
    if (endIdx !== -1) {
      const candidateStr = description.substring(startIdx, endIdx + 1);
      try {
        const parsed = YAML.parse(candidateStr);
        if (Array.isArray(parsed) && parsed.length > 0) {
          candidateItems = parsed.map(String);
          break;
        }
      } catch (e) {}
    }
    startIdx = description.indexOf('[', startIdx + 1);
  }

  // 2. Look for header lines like "Allowed areas:", "Available items:", "Valid options:", "Valid options are:", "Locations:", "Items:", "Options:"
  // or inline "Possible values:" labels followed by a comma-separated list.
  // Always run to capture valid options like 'marsh' that only appear in description text, not the template's weighted block.
  {
    const lines = description.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const headerMatch = line.match(/^(?:Allowed|Valid|Available|Possible|Supported)?\s*(?:areas|locations|items|options|choices|pool|values)(?:\s+are)?:\s*(.*)$/i);
      if (headerMatch) {
        let textBlock = headerMatch[1].trim();
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j].trim();
          if (!nextLine || nextLine.match(/^(?:Allowed|Valid|Available|Possible|Supported)?\s*(?:areas|locations|items|options|choices|pool|values)(?:\s+are)?:/i) || nextLine.startsWith('-')) {
            break;
          }
          textBlock += ' ' + nextLine;
          j++;
        }

        if (textBlock) {
          if (textBlock.startsWith('[') && textBlock.includes(']')) {
            const arrSub = textBlock.substring(textBlock.indexOf('['), textBlock.indexOf(']') + 1);
            try {
              const parsed = YAML.parse(arrSub);
              if (Array.isArray(parsed) && parsed.length > 0) {
                const newItems = parsed.map(String);
                if (!candidateItems) {
                  candidateItems = newItems;
                } else {
                  for (const item of newItems) {
                    if (!candidateItems.includes(item)) candidateItems.push(item);
                  }
                }
                break;
              }
            } catch (e) {}
          }

          let cleanBlock = textBlock.replace(/\s+in\s+any\s+(?:combination|order|case)\.?;?.*$/i, '');
          cleanBlock = cleanBlock.replace(/\s+etc\.?$/i, '');
          cleanBlock = cleanBlock.trim().replace(/\.$/, '');

          const splitItems = cleanBlock
            .split(/,|\b(?:and|or)\b/i)
            .map(s => s.trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean);

          if (splitItems.length > 0) {
            if (!candidateItems) {
              candidateItems = splitItems;
            } else {
              for (const item of splitItems) {
                if (!candidateItems.includes(item)) candidateItems.push(item);
              }
            }
            break;
          }
        }
      }
    }
  }

  // 3. Extract items from bullet points ("- Key: Description") OR unbulleted option descriptions ("Key:", "Key: Description")
  const extractedOptionKeys = [];
  const excludedHeaders = new Set([
    'categories', 'locations', 'items', 'options', 'choices', 'allowed areas', 'available items',
    'valid options', 'valid options are', 'allowed options', 'allowed options are', 'options are',
    'choices are', 'values are', 'minimum value', 'maximum value', 'note', 'warning', 'disclaimer',
    'important note', 'important', 'tip', 'info', 'notice', 'caution', 'requirement', 'example',
    'examples', 'actual options', 'side effects', 'remember',
    'q', 'a', 'description', 'teleporter name', 'possible values', 'teleporter name:', 'possible values:'
  ]);
  if (settingKey) {
    excludedHeaders.add(settingKey.toLowerCase());
  }

  function cleanCandidateKey(str) {
    if (!str || typeof str !== 'string') return '';
    let cleaned = str
      .replace(/[*~`]+/g, '')
      .replace(/\s*\([^)]*\)/g, '')
      .trim();
    
    const lower = cleaned.toLowerCase();
    const invalidHeaders = [
      'teleporter name',
      'possible values',
      'allowed values',
      'valid options',
      'available options',
      'option name',
      'how to',
      'note',
      'warning',
      'example',
      'default'
    ];
    if (invalidHeaders.some(h => lower === h || lower.startsWith(h + ':') || lower.startsWith(h + ' '))) {
      return '';
    }
    return cleaned;
  }

  let inNonOptionSection = false;
  const lines = description.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const lowerTrimmed = trimmed.toLowerCase().replace(/^[*_~`#]+|[*_~`#]+$/g, '').trim();

    // Check for section header transitions like SIDE EFFECTS, EXAMPLES, EXAMPLE, NOTES, WARNING
    if (
      lowerTrimmed.startsWith('side effect') ||
      lowerTrimmed.startsWith('example') ||
      lowerTrimmed.startsWith('note:') ||
      lowerTrimmed.startsWith('warning:') ||
      lowerTrimmed.startsWith('disclaimer:') ||
      lowerTrimmed.startsWith('important note:') ||
      lowerTrimmed.startsWith('important:')
    ) {
      inNonOptionSection = true;
      continue;
    }

    if (lowerTrimmed.startsWith('actual option') || lowerTrimmed.startsWith('option') || lowerTrimmed.startsWith('valid option')) {
      inNonOptionSection = false;
      continue;
    }

    if (inNonOptionSection) {
      continue;
    }

    // Check for bullet point line: "- Key: Description" or "- Key description"
    const bulletMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bulletMatch && bulletMatch[1]) {
      let content = bulletMatch[1].trim().replace(/^[*_~`]+/, '');
      const lowerContent = content.toLowerCase();
      if (
        lowerContent.startsWith('minimum') ||
        lowerContent.startsWith('maximum') ||
        lowerContent.startsWith('text:') ||
        lowerContent.startsWith('item:') ||
        lowerContent.startsWith('location:') ||
        lowerContent.startsWith('player:') ||
        lowerContent.startsWith('percentage:') ||
        lowerContent.startsWith('at:')
      ) {
        continue;
      }
      const colonIdx = content.indexOf(':');
      if (colonIdx !== -1) {
        content = content.substring(0, colonIdx).trim();
      } else {
        const verbRegex = /\s+(?:includes|has|is|are|adds|allows|gives|sets|will|can|contains|requires|equivalent|means|afflict|afflicts|trigger|triggers|use|uses|spin|spins|make|makes|faint|faints|slow|slows|randomize|randomizes)\b/i;
        const verbMatch = content.match(verbRegex);
        if (verbMatch) {
          content = content.substring(0, verbMatch.index).trim();
        }
      }
      content = cleanCandidateKey(content);
      content = content.replace(/^["']|["']$/g, '').trim();
      if (content && content.length <= 40 && !/^\d+$/.test(content) && !excludedHeaders.has(content.toLowerCase()) && !extractedOptionKeys.includes(content)) {
        extractedOptionKeys.push(content);
      }
      continue;
    }

    // Check for unbulleted line: "Key Name:" OR "Key Name: Description" (handling markdown bolding like **Key Name**:)
    const cleanLine = trimmed.replace(/^[*_~`]+/, '').replace(/[*_~`]+\s*:/, ':').trim();
    const proseSentenceRegex = /\b(?:should|provided|form|example|must|refer|according|specified|defined|listed|such|information|details|following|format|syntax)\b/i;
    const headerPrefixRegex = /^(?:with|uses|format|supported|available|only|for|note|important|set|select|list|include|prevents|forces|refer|according|this|that|these|those)\b/i;
    const keyMatch = cleanLine.match(/^([A-Za-z0-9_\-\s'*\(\)]+):\s*(.*)$/);
    if (keyMatch && keyMatch[1]) {
      let keyName = cleanCandidateKey(keyMatch[1]);
      keyName = keyName.replace(/^["']|["']$/g, '').trim();
      const lowerKey = keyName.toLowerCase();
      if (
        keyName &&
        !/^\d+$/.test(keyName) &&
        !excludedHeaders.has(lowerKey) &&
        !proseSentenceRegex.test(lowerKey) &&
        !headerPrefixRegex.test(lowerKey) &&
        !lowerKey.includes(' as ') &&
        !lowerKey.includes(' to ') &&
        !lowerKey.includes(' is ') &&
        !extractedOptionKeys.includes(keyName)
      ) {
        if (keyName.length <= 35 && !lowerKey.startsWith('q.') && !lowerKey.startsWith('a.')) {
          const verbRegex = /\s+(?:includes|has|is|adds|allows|gives|sets|will|can|contains|requires|equivalent|means)\b/i;
          const verbMatch = keyName.match(verbRegex);
          if (verbMatch) {
            keyName = keyName.substring(0, verbMatch.index).trim();
          }
          keyName = cleanCandidateKey(keyName);
          if (
            keyName &&
            !excludedHeaders.has(keyName.toLowerCase()) &&
            !proseSentenceRegex.test(keyName) &&
            !headerPrefixRegex.test(keyName) &&
            !keyName.toLowerCase().includes(' as ') &&
            !extractedOptionKeys.includes(keyName)
          ) {
            extractedOptionKeys.push(keyName);
          }
        }
      }
    }
  }

  if (!candidateItems && extractedOptionKeys.length > 0) {
    candidateItems = extractedOptionKeys;
  } else if (candidateItems && extractedOptionKeys.length > 0) {
    for (const ek of extractedOptionKeys) {
      if (!candidateItems.includes(ek)) {
        candidateItems.push(ek);
      }
    }
  }

  // 4. Detect special keywords (_-prefixed words like _Johto, _Kanto, _Legendaries)
  // Or quoted option terms only as fallback when no explicit keys were found
  const foundSpecials = [];
  const stateTerms = new Set(['off', 'on', 'true', 'false', 'none', 'null', '0', '1']);
  
  const underscoreMatches = description.match(/(?:^|\s|\()(_[A-Za-z0-9_-]+)/g);
  if (underscoreMatches) {
    for (const rawUm of underscoreMatches) {
      const um = rawUm.replace(/^[(\s]+/, '').trim();
      if (um && !foundSpecials.includes(um)) {
        foundSpecials.push(um);
      }
    }
  }

  // Only scrape general quoted strings if NO candidate items or explicit keys were found
  const hasExistingOptions = (candidateItems && candidateItems.length > 0) || extractedOptionKeys.length > 0;
  if (!hasExistingOptions) {
    const proseRegex = /(?:is where|are connection|is the door|forces the|cannot be|is the|of the form|arrival side|refers to|used for|depends on|is set to|set to|accessible if|defines which|appear in|provided in)/i;
    const linesForQuoted = description.split('\n');
    for (const line of linesForQuoted) {
      if (proseRegex.test(line)) continue;
      const matches = [];
      const doubleQuoted = line.match(/"([^"\n]{1,30})"/g);
      if (doubleQuoted) {
        for (const dq of doubleQuoted) {
          matches.push(dq.replace(/^"|"$/g, ''));
        }
      }
      const singleQuoted = line.match(/(?<![a-zA-Z])'([^'\n]{1,30})'/g);
      if (singleQuoted) {
        for (const sq of singleQuoted) {
          matches.push(sq.replace(/^'|'$/g, ''));
        }
      }

      for (const cleanTerm of matches) {
        const trimmedTerm = cleanTerm.trim();
        if (
          trimmedTerm &&
          !stateTerms.has(trimmedTerm.toLowerCase()) &&
          !excludedHeaders.has(trimmedTerm.toLowerCase()) &&
          !foundSpecials.includes(trimmedTerm)
        ) {
          if (!trimmedTerm.includes('.') && !trimmedTerm.includes('?') && !trimmedTerm.includes('!')) {
            foundSpecials.push(trimmedTerm);
          }
        }
      }
    }
  }

  if (foundSpecials.length > 0) {
    if (!candidateItems) candidateItems = [];
    for (const sp of foundSpecials) {
      if (!candidateItems.includes(sp)) {
        candidateItems.push(sp);
      }
    }
  }

  // 5. Look for dict literal substring {...}
  let dictStart = description.indexOf('{');
  while (dictStart !== -1) {
    let dictEnd = description.indexOf('}', dictStart);
    if (dictEnd !== -1) {
      const candidateStr = description.substring(dictStart, dictEnd + 1);
      try {
        const parsed = YAML.parse(candidateStr);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          candidateDict = parsed;
          break;
        }
      } catch (e) {}
    }
    dictStart = description.indexOf('{', dictStart + 1);
  }

  return { candidateItems, candidateDict };
}

function coerceValue(val) {
  if (typeof val !== 'string') return val;
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (!isNaN(val) && !isNaN(parseFloat(val))) return Number(val);
  return val;
}

function cleanSetting(setting) {
  delete setting.rawLines;
  delete setting.inlineValue;
  
  if (setting.defaultValue !== undefined) {
    if (Array.isArray(setting.defaultValue)) {
      setting.defaultValue = setting.defaultValue.map(coerceValue);
    } else if (typeof setting.defaultValue === 'object' && setting.defaultValue !== null) {
      for (const k of Object.keys(setting.defaultValue)) {
        setting.defaultValue[k] = coerceValue(setting.defaultValue[k]);
      }
    } else {
      setting.defaultValue = coerceValue(setting.defaultValue);
    }
  }

  if (Array.isArray(setting.defaultValue) && setting.defaultValue.length > 0) {
    if (!setting.candidateItems) {
      setting.candidateItems = [];
    }
    for (const item of setting.defaultValue) {
      const itemStr = String(item);
      if (!setting.candidateItems.includes(itemStr)) {
        setting.candidateItems.push(itemStr);
      }
    }
  }

  if (setting.options) {
    for (const opt of setting.options) {
      opt.value = coerceValue(opt.value);
    }
  }

  return setting;
}
