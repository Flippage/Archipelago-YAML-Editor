import { useState, useEffect, useMemo } from 'react'
import SettingControl from './SettingControl'

const DEFAULT_YAML_DIR = 'C:\\ProgramData\\Archipelago\\YAML'
import YAML from 'yaml'

export default function Editor({ template, existingYaml, onBack, addToast }) {
  const [playerName, setPlayerName] = useState(template.name || 'Player{number}')
  const [description, setDescription] = useState(template.description || '')
  const [filename, setFilename] = useState('')
  const [saving, setSaving] = useState(false)
  const [settingValues, setSettingValues] = useState({})
  const [settingModes, setSettingModes] = useState({}) // key -> 'fixed' | 'weighted'
  const [collapsedGroups, setCollapsedGroups] = useState({})
  const [searchSettings, setSearchSettings] = useState('')

  // Initialize from template defaults or existing YAML
  useEffect(() => {
    // Scroll to top when opening the editor
    window.scrollTo(0, 0)

    const values = {}
    const modes = {}

    if (existingYaml?.content) {
      // Loading from existing YAML
      const yaml = existingYaml.content
      const nameVal = yaml.name || 'Player{number}'
      setPlayerName(typeof nameVal === 'object' ? JSON.stringify(nameVal) : nameVal)
      setDescription(yaml.description || '')
      if (existingYaml.filename) {
        setFilename(existingYaml.filename.replace('.yaml', ''))
      }

      const gameSettings = yaml[template.gameName] || {}

      for (const setting of template.settings) {
        const existingVal = gameSettings[setting.key]
        if (existingVal !== undefined) {
          if (Array.isArray(existingVal)) {
            modes[setting.key] = 'list'
            values[setting.key] = existingVal
          } else if (setting.type === 'choice' || setting.type === 'range') {
            if (existingVal === 'random') {
              modes[setting.key] = 'random'
              values[setting.key] = 'random'
            } else if (typeof existingVal === 'object' && !Array.isArray(existingVal) && existingVal !== null) {
              const entries = Object.entries(existingVal)
              const nonZeroEntries = entries.filter(([_, w]) => Number(w) > 0)
              if (nonZeroEntries.length === 1 && entries.length === 1) {
                // Single non-zero weight option -> Fixed/Preset mode!
                modes[setting.key] = 'fixed'
                values[setting.key] = parseSettingValue(nonZeroEntries[0][0])
              } else {
                // Multiple options or weighted mapping -> Weighted mode!
                modes[setting.key] = 'weighted'
                const weightMap = {}
                for (const opt of setting.options || []) {
                  weightMap[opt.value] = existingVal[opt.value] ?? 0
                }
                for (const [k, v] of Object.entries(existingVal)) {
                  if (!(k in weightMap)) {
                    // Only filter clearly bogus keys from malformed YAML (markdown artifacts, prose labels)
                    // Do NOT use a strict whitelist — valid options like 'marsh' may exist in the game
                    // without appearing in the template's weighted block
                    const isBogus = k.includes('**') || k.includes('(or ') || k.toLowerCase().includes('teleporter name') || k.toLowerCase().includes('possible values')
                    if (!isBogus) {
                      weightMap[k] = v
                    }
                  }
                }
                values[setting.key] = weightMap
              }
            } else {
              // Fixed mode
              modes[setting.key] = 'fixed'
              values[setting.key] = existingVal
            }
          } else if (setting.type === 'list') {
            modes[setting.key] = 'list'
            values[setting.key] = Array.isArray(existingVal) ? existingVal : []
          } else if (setting.type === 'dict') {
            const lowerKey = setting.key.toLowerCase()
            const hasCandidateDict = setting.candidateDict && Object.keys(setting.candidateDict).length > 0
            const isGameOptions = lowerKey === 'game_options' || lowerKey.endsWith('_options')
            const isWeightedMap = !hasCandidateDict && !isGameOptions && (lowerKey.includes('weights') || lowerKey.includes('distribution'))

            modes[setting.key] = isWeightedMap ? 'weighted' : 'dict'
            values[setting.key] = typeof existingVal === 'object' && existingVal !== null ? existingVal : {}
          } else {
            modes[setting.key] = 'fixed'
            values[setting.key] = existingVal
          }
        } else {
          // Setting not in existing YAML — use template defaults
          initSettingDefault(setting, values, modes)
        }
      }
    } else {
      // New YAML from template
      for (const setting of template.settings) {
        initSettingDefault(setting, values, modes)
      }
    }

    setSettingValues(values)
    setSettingModes(modes)
  }, [template, existingYaml])

  function initSettingDefault(setting, values, modes) {
    if (setting.type === 'choice' || setting.type === 'range') {
      // Default to fixed mode with the highest-weighted option
      modes[setting.key] = 'fixed'
      const best = (setting.options || [])
        .filter(o => !String(o.value).startsWith('random'))
        .reduce((a, b) => (b.weight > a.weight ? b : a), { value: '', weight: -1 })
      values[setting.key] = best.weight > -1 ? best.value : (setting.options?.[0]?.value ?? '')
    } else if (setting.type === 'list') {
      modes[setting.key] = 'list'
      values[setting.key] = setting.defaultValue || []
    } else if (setting.type === 'dict') {
      const def = setting.defaultValue || {}
      const lowerKey = setting.key.toLowerCase()
      const hasCandidateDict = setting.candidateDict && Object.keys(setting.candidateDict).length > 0
      const isGameOptions = lowerKey === 'game_options' || lowerKey.endsWith('_options')
      const isWeightedMap = !hasCandidateDict && !isGameOptions && (lowerKey.includes('weights') || lowerKey.includes('distribution'))

      modes[setting.key] = isWeightedMap ? 'weighted' : 'dict'
      values[setting.key] = def
    } else {
      modes[setting.key] = 'fixed'
      values[setting.key] = setting.defaultValue ?? ''
    }
  }

  // Group settings
  const groups = useMemo(() => {
    const map = new Map()
    for (const s of template.settings) {
      const group = s.group || 'General'
      if (!map.has(group)) map.set(group, [])
      map.get(group).push(s)
    }
    return map
  }, [template.settings])

  function updateSettingValue(key, value) {
    setSettingValues(prev => ({ ...prev, [key]: value }))
  }

  function updateSettingMode(key, mode) {
    setSettingModes(prev => ({ ...prev, [key]: mode }))

    // When switching modes, convert the value
    const setting = template.settings.find(s => s.key === key)
    if (!setting) return

    if (mode === 'list') {
      const current = settingValues[key]
      if (!Array.isArray(current)) {
        updateSettingValue(key, [])
      }
    } else if (mode === 'dict') {
      const current = settingValues[key]
      if (typeof current !== 'object' || current === null || Array.isArray(current)) {
        updateSettingValue(key, {})
      }
    } else if (mode === 'weighted') {
      // Convert fixed value to weighted map
      const currentFixed = settingValues[key]
      const weightMap = {}
      for (const opt of setting.options || []) {
        weightMap[opt.value] = opt.value === String(currentFixed) ? 50 : 0
      }
      updateSettingValue(key, weightMap)
    } else if (mode === 'fixed') {
      // Convert to fixed preset
      const current = settingValues[key]
      if (typeof current === 'object' && !Array.isArray(current) && current !== null) {
        let best = ''
        let bestW = -1
        for (const [k, v] of Object.entries(current)) {
          if (v > bestW && !k.startsWith('random')) {
            bestW = v
            best = k
          }
        }
        updateSettingValue(key, bestW > -1 ? best : (setting.options?.[0]?.value ?? 'All'))
      } else if (Array.isArray(current)) {
        updateSettingValue(key, setting.options?.[0]?.value || 'All')
      }
    }
  }

  function toggleGroup(group) {
    setCollapsedGroups(prev => ({ ...prev, [group]: !prev[group] }))
  }

  // Helper to parse strings into numbers/booleans where applicable
  function parseSettingValue(val) {
    if (typeof val !== 'string') return val;
    const lower = val.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    if (!isNaN(val) && val.trim() !== '') {
      return Number(val);
    }
    return val;
  }

  // Build the YAML data object
  function buildYamlData() {
    const gameSettings = {}

    for (const setting of template.settings) {
      const mode = settingModes[setting.key]
      const val = settingValues[setting.key]

      if (mode === 'random') {
        gameSettings[setting.key] = 'random'
      } else if (mode === 'list' || (setting.type === 'list' && mode !== 'fixed')) {
        gameSettings[setting.key] = Array.isArray(val) ? val.map(parseSettingValue) : []
      } else if (mode === 'dict' || (setting.type === 'dict' && mode !== 'weighted' && mode !== 'fixed')) {
        const cleanedDict = {}
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          for (const [k, v] of Object.entries(val)) {
            cleanedDict[k] = parseSettingValue(v)
          }
        }
        gameSettings[setting.key] = cleanedDict
      } else if (mode === 'weighted') {
        if (typeof val === 'object' && !Array.isArray(val) && val !== null) {
          const cleaned = {}
          for (const [k, w] of Object.entries(val)) {
            const isBogus = k.includes('**') || k.includes('(or ') || k.toLowerCase().includes('teleporter name') || k.toLowerCase().includes('possible values')
            if (!isBogus) {
              cleaned[k] = Number(w) || 0
            }
          }
          gameSettings[setting.key] = cleaned
        } else {
          gameSettings[setting.key] = val
        }
      } else {
        // Fixed mode
        gameSettings[setting.key] = parseSettingValue(val)
      }
    }

    let finalName = playerName
    try {
      if (String(playerName).trim().startsWith('{')) {
        finalName = JSON.parse(String(playerName).trim())
      }
    } catch(e) {}

    return {
      name: finalName,
      description: description || `YAML generated by Archipelago YAML Editor`,
      game: template.gameName,
      requires: template.requires || {},
      [template.gameName]: gameSettings,
    }
  }

  async function handleSave() {
    if (!filename.trim()) {
      addToast('Please enter a filename', 'error')
      return
    }

    setSaving(true)
    try {
      const data = buildYamlData()
      const yamlString = YAML.stringify(data)
      const saveName = filename.trim().endsWith('.yaml') ? filename.trim() : `${filename.trim()}.yaml`
      
      // Try using the File System Access API first (supported in Chrome/Edge)
      if (window.showSaveFilePicker) {
        try {
          const fileHandle = await window.showSaveFilePicker({
            suggestedName: saveName,
            types: [{
              description: 'YAML File',
              accept: { 'text/yaml': ['.yaml', '.yml'] },
            }],
          })
          const writable = await fileHandle.createWritable()
          await writable.write(yamlString)
          await writable.close()
          addToast(`Saved to ${fileHandle.name}`, 'success')
        } catch (err) {
          // If the user aborts, don't show an error
          if (err.name !== 'AbortError') {
             throw err
          }
        }
      } else {
        // Fallback for browsers that don't support showSaveFilePicker (e.g. Firefox, Safari)
        const blob = new Blob([yamlString], { type: 'text/yaml' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = saveName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        addToast(`Downloaded ${saveName}`, 'success')
      }
    } catch (err) {
      addToast('Save failed: ' + err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // Filter settings by search
  const filteredGroups = useMemo(() => {
    if (!searchSettings) return groups
    const filtered = new Map()
    for (const [group, settings] of groups) {
      const matches = settings.filter(s =>
        String(s.key).toLowerCase().includes(searchSettings.toLowerCase()) ||
        (s.description && String(s.description).toLowerCase().includes(searchSettings.toLowerCase())) ||
        String(group).toLowerCase().includes(searchSettings.toLowerCase())
      )
      if (matches.length > 0) filtered.set(group, matches)
    }
    return filtered
  }, [groups, searchSettings])

  const totalSettings = template.settings.length
  const gameVersion = template.requires?.game?.[template.gameName] || ''

  return (
    <div className="editor-container">
      {/* Header */}
      <div className="editor-header">
        <div className="editor-header-left">
          <div className="editor-game-title">
            <button className="editor-back-btn" onClick={onBack} title="Back to Dashboard">
              ←
            </button>
            <h1>{template.gameName}</h1>
            {gameVersion && (
              <span className="game-card-version">APWorld v{gameVersion}</span>
            )}
          </div>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
            {totalSettings} settings available
            {template.requires?.version && ` · Archipelago v${template.requires.version}`}
          </p>
        </div>
      </div>

      {/* Player Meta */}
      <div className="editor-meta">
        <div className="input-group">
          <label className="input-label">Player Name</label>
          <input
            className="input"
            type="text"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            placeholder="Player{number}"
            maxLength={16}
          />
        </div>
        <div className="input-group">
          <label className="input-label">Filename</label>
          <input
            className="input"
            type="text"
            value={filename}
            onChange={e => setFilename(e.target.value)}
            placeholder="e.g. MyPlayerName"
          />
        </div>
        <div className="input-group editor-meta-full">
          <label className="input-label">Description</label>
          <input
            className="input"
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional description for this YAML"
          />
        </div>
      </div>

      {/* Settings Search */}
      <div className="search-bar" style={{ maxWidth: '100%', marginBottom: '1.5rem' }}>
        <span className="search-icon">🔍</span>
        <input
          type="text"
          className="input"
          placeholder="Search settings..."
          value={searchSettings}
          onChange={e => setSearchSettings(e.target.value)}
          style={{ paddingLeft: '2.75rem' }}
        />
      </div>

      {/* Settings Groups */}
      {Array.from(filteredGroups).map(([group, settings]) => (
        <div key={group} className="settings-group">
          <div className="settings-group-header" onClick={() => toggleGroup(group)}>
            <span className="settings-group-title">{group}</span>
            <span className="settings-group-count">{settings.length}</span>
            <span className={`settings-group-chevron ${collapsedGroups[group] ? 'collapsed' : ''}`}>
              ▾
            </span>
          </div>
          {!collapsedGroups[group] && (
            <div className="settings-list">
              {settings.map(setting => (
                <SettingControl
                  key={setting.key}
                  setting={setting}
                  value={settingValues[setting.key]}
                  mode={settingModes[setting.key] || 'fixed'}
                  onChange={val => updateSettingValue(setting.key, val)}
                  onModeChange={mode => updateSettingMode(setting.key, mode)}
                />
              ))}
            </div>
          )}
        </div>
      ))}

      {filteredGroups.size === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🔎</div>
          <div className="empty-state-title">No settings match your search</div>
        </div>
      )}

      {/* Save Bar */}
      <div className="save-bar">
        <div className="save-bar-path">
          {/* File location is now handled by the browser save dialog */}
        </div>
        <div className="save-bar-actions">
          <button 
            className="btn btn-secondary" 
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            ⬆️ Top
          </button>
          <button className="btn btn-secondary" onClick={onBack}>
            Cancel
          </button>
          <button
            className="btn btn-success btn-lg"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <>
                <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }}></div>
                Saving...
              </>
            ) : (
              <>💾 Save YAML</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
