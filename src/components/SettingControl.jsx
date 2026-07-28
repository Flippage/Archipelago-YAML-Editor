import { useState, useEffect } from 'react'
import YAML from 'yaml'

export default function SettingControl({ setting, value, mode, onChange, onModeChange }) {
  const { key, type, description, isHybridSet, candidateItems, candidateDict, options } = setting

  const hasOptions = options && options.length > 0
  const hasCandidates = (candidateItems && candidateItems.length > 0) || (candidateDict && Object.keys(candidateDict).length > 0)
  const isPureScalar = type === 'scalar' && !hasOptions && !hasCandidates

  const isWeightable = !isPureScalar && (type === 'choice' || type === 'range' || hasOptions || type === 'dict')
  const isListOrDict = !isPureScalar && (type === 'list' || type === 'dict' || isHybridSet || hasCandidates)
  const showToggle = !isPureScalar && (isWeightable || isHybridSet || isListOrDict)

  const isDictType = type === 'dict' || (candidateDict && Object.keys(candidateDict).length > 0)
  const prefersList = !isDictType && (type === 'list' || (candidateItems && candidateItems.length > 0) || Array.isArray(value))
  const customMode = prefersList ? 'list' : 'dict'
  const customLabel = prefersList ? 'Custom List [ ]' : 'Custom List / Dict'

  return (
    <div className="setting-card">
      <div className="setting-header">
        <div style={{ flex: 1 }}>
          <div className="setting-name">{key}</div>
          {description && (
            <div className="setting-description">{formatDescription(description)}</div>
          )}
        </div>
        {showToggle && (
          <div className="mode-toggle">
            <button
              className={`mode-toggle-btn ${mode === 'fixed' ? 'active' : ''}`}
              onClick={() => onModeChange('fixed')}
            >
              Fixed / Preset
            </button>
            {isListOrDict && (
              <button
                className={`mode-toggle-btn ${mode === 'list' || mode === 'dict' ? 'active' : ''}`}
                onClick={() => onModeChange(customMode)}
              >
                {customLabel}
              </button>
            )}
            {isWeightable && (
              <button
                className={`mode-toggle-btn ${mode === 'weighted' ? 'active' : ''}`}
                onClick={() => onModeChange('weighted')}
              >
                Weighted
              </button>
            )}
            {isWeightable && (
              <button
                className={`mode-toggle-btn ${mode === 'random' ? 'active' : ''}`}
                onClick={() => onModeChange('random')}
              >
                🎲 Random
              </button>
            )}
          </div>
        )}
      </div>

      <div className="setting-controls">
        {mode === 'fixed' && (
          <FixedChoiceControl
            setting={setting}
            value={value}
            onChange={onChange}
          />
        )}
        {mode === 'weighted' && (
          <WeightedControl
            setting={setting}
            value={value}
            onChange={onChange}
          />
        )}
        {mode === 'random' && (
          <div className="empty-state" style={{ padding: '2rem' }}>
            <div className="empty-state-icon" style={{ fontSize: '2rem' }}>🎲</div>
            <div className="empty-state-title" style={{ fontSize: '1.2rem' }}>Randomized Setting</div>
            <div className="empty-state-text">
              Archipelago will randomly select a valid option for this setting during generation.
            </div>
          </div>
        )}
        {mode === 'list' && (
          <ListControl setting={setting} candidateItems={candidateItems} value={value} onChange={onChange} />
        )}
        {mode === 'dict' && (
          <DictControl setting={setting} candidateItems={candidateItems} candidateDict={candidateDict} value={value} onChange={onChange} />
        )}
        {type === 'scalar' && mode !== 'list' && mode !== 'dict' && mode !== 'weighted' && mode !== 'random' && (
          <ScalarControl value={value} onChange={onChange} />
        )}
      </div>
    </div>
  )
}

// ─── Fixed Choice ────────────────────────────────────────────────────────────
function FixedChoiceControl({ setting, value, onChange }) {
  const { options, type, min, max } = setting

  // For range type, allow a custom numeric input alongside the dropdown
  if (type === 'range') {
    const namedOptions = (options || []).filter(o => !String(o.value).startsWith('random-range'))
    return (
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="input-group" style={{ minWidth: 180 }}>
          <label className="input-label">Preset</label>
          <select
            className="select"
            value={value}
            onChange={e => onChange(e.target.value)}
          >
            {namedOptions.map(opt => (
              <option key={opt.value} value={opt.value}>
                {formatOptionLabel(opt.value, setting)}
                {opt.comment ? ` (${opt.comment})` : ''}
              </option>
            ))}
          </select>
        </div>
        {min !== null && max !== null && (
          <div className="input-group" style={{ minWidth: 140 }}>
            <label className="input-label">
              Custom Value ({min}–{max})
            </label>
            <input
              className="input"
              type="number"
              min={min}
              max={max}
              value={isNaN(Number(value)) ? '' : value}
              onChange={e => onChange(e.target.value)}
              placeholder={`${min}–${max}`}
            />
          </div>
        )}
      </div>
    )
  }

  // Regular choice: simple dropdown or custom text input if options are empty
  const baseOptions = (options || []).filter(o => !String(o.value).startsWith('random-'))
  const existingValues = new Set(baseOptions.map(o => normalizeKey(o.value)))

  const extraCandidates = (setting.candidateItems || [])
    .filter(c => {
      const s = String(c).trim()
      const norm = normalizeKey(s)
      return s && !s.startsWith('random') && norm && !existingValues.has(norm)
    })
    .map(c => ({ value: String(c), weight: 0, comment: '' }))

  const validOptions = [...baseOptions, ...extraCandidates]

  let selectedValue = value
  if (value !== undefined && value !== null && String(value).trim() !== '' && !String(value).startsWith('random')) {
    const strVal = String(value)
    const normVal = normalizeKey(strVal)
    const match = validOptions.find(o => normalizeKey(o.value) === normVal)
    if (match) {
      selectedValue = match.value
    } else if (normVal) {
      validOptions.push({ value: strVal, weight: 0, comment: '' })
    }
  }

  const presetCount = baseOptions.length + extraCandidates.length
  
  if (presetCount <= 1) {
    const candidates = [...baseOptions, ...extraCandidates].map(o => String(o.value).trim()).filter(Boolean)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 450 }}>
        <input
          className="input"
          type="text"
          value={selectedValue ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder={`Enter ${setting.key.replace(/_/g, ' ')}...`}
        />
        {candidates.length > 0 && (
          <div className="preset-chips-grid">
            {candidates.map((cand, idx) => {
              const isSelected = normalizeKey(String(selectedValue)) === normalizeKey(cand)
              return (
                <button
                  key={idx}
                  type="button"
                  className={`chip-btn ${isSelected ? 'active' : ''}`}
                  onClick={() => onChange(cand)}
                >
                  <span className="chip-icon">{isSelected ? '✓' : '+'}</span>
                  {formatOptionLabel(cand, setting)}
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <select
      className="select"
      value={String(selectedValue ?? '')}
      onChange={e => onChange(e.target.value)}
      style={{ maxWidth: 400 }}
    >
      {validOptions.map(opt => (
        <option key={String(opt.value)} value={String(opt.value)}>
          {formatOptionLabel(opt.value, setting)}
          {opt.comment ? ` — ${opt.comment}` : ''}
        </option>
      ))}
    </select>
  )
}

// ─── Weighted Control ────────────────────────────────────────────────────────
function WeightedControl({ setting, value, onChange }) {
  const weights = typeof value === 'object' && value !== null ? value : {}
  const [newCustomKey, setNewCustomKey] = useState('')

  function setWeight(optKey, valStr) {
    const w = parseInt(valStr, 10)
    onChange({
      ...weights,
      [optKey]: isNaN(w) ? 0 : w
    })
  }

  function addCustomKey() {
    const key = newCustomKey.trim()
    if (key && !(key in weights)) {
      setWeight(key, '0')
      setNewCustomKey('')
    }
  }

  function removeCustomKey(key) {
    const newWeights = { ...weights }
    delete newWeights[key]
    onChange(newWeights)
  }

  const baseOptions = setting.options || []
  const baseOptionValues = new Set(baseOptions.map(o => normalizeKey(o.value)))

  const isBogusKey = (str) => {
    if (!str) return true
    const s = String(str)
    return s.includes('**') || s.includes('(or ') || s.toLowerCase().includes('teleporter name') || s.toLowerCase().includes('possible values')
  }

  const candidateOptions = (setting.candidateItems || [])
    .filter(c => {
      const s = String(c).trim()
      const norm = normalizeKey(s)
      return s && !s.startsWith('random') && norm && !baseOptionValues.has(norm) && !isBogusKey(s)
    })
    .map(c => ({ value: String(c), weight: 0, comment: '' }))

  const combinedBase = [...baseOptions, ...candidateOptions]
  const combinedNormValues = new Set(combinedBase.map(o => normalizeKey(o.value)))

  const customOptions = Object.keys(weights)
    .filter(k => !combinedNormValues.has(normalizeKey(k)) && !isBogusKey(k))
    .map(k => ({ value: k, isCustom: true }))

  const allOptions = [...combinedBase, ...customOptions]

  const totalWeight = Object.values(weights).reduce((a, b) => a + (Number(b) || 0), 0)

  return (
    <div className="weight-editor">
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '0.25rem',
        padding: '0 0.5rem'
      }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
          Option
        </span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
          Total Weight: {totalWeight}
        </span>
      </div>
      {allOptions.map(opt => {
        const w = Number(weights[opt.value]) || 0
        const pct = totalWeight > 0 ? ((w / totalWeight) * 100).toFixed(1) : '0.0'
        return (
          <div key={opt.value} className="weight-row">
            {opt.isCustom ? (
              <button 
                className="btn-icon" 
                onClick={() => removeCustomKey(opt.value)}
                title="Remove custom option"
                style={{ color: '#ef4444', marginRight: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                ✕
              </button>
            ) : null}
            <span className="weight-label" title={opt.comment || ''} style={opt.isCustom ? { color: '#a78bfa' } : {}}>
              {formatOptionLabel(opt.value, setting)}
            </span>
            <input
              className="weight-input"
              type="number"
              min={0}
              value={w}
              onChange={e => setWeight(opt.value, e.target.value)}
            />
            <div className="weight-bar-container">
              <div
                className="weight-bar"
                style={{ width: `${totalWeight > 0 ? (w / totalWeight) * 100 : 0}%` }}
              />
            </div>
            <span className="weight-percent">{pct}%</span>
            {opt.comment && (
              <span className="weight-comment" title={opt.comment}>
                {opt.comment}
              </span>
            )}
          </div>
        )
      })}
      <div className="weight-row" style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
        <input 
          className="input"
          style={{ flex: 1, padding: '0.4rem' }}
          type="text" 
          placeholder="Add custom option (e.g. random-range-3-7)" 
          value={newCustomKey}
          onChange={e => setNewCustomKey(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addCustomKey()}
        />
        <button className="btn btn-secondary" onClick={addCustomKey} style={{ padding: '0.4rem 1rem' }}>
          Add
        </button>
      </div>
    </div>
  )
}

function renderValue(val) {
  if (typeof val === 'object' && val !== null) {
    return JSON.stringify(val)
  }
  return String(val ?? '')
}

function parseValue(valStr) {
  const trimmed = valStr.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch(e) {
      return valStr
    }
  }
  return valStr
}

// ─── List Control ────────────────────────────────────────────────────────────
function ListControl({ setting, candidateItems, value, onChange }) {
  const items = Array.isArray(value) ? value : []
  const [newItem, setNewItem] = useState('')

  // Determine view mode: default to 'raw' if exampleYaml exists or if items contain complex objects
  const [viewMode, setViewMode] = useState(() => {
    if (setting?.exampleYaml || items.some(i => typeof i === 'object' && i !== null)) {
      return 'raw'
    }
    return 'list'
  })

  const [rawText, setRawText] = useState(() => {
    try {
      return YAML.stringify(value ?? items)
    } catch (e) {
      return ''
    }
  })
  const [rawError, setRawError] = useState(null)

  useEffect(() => {
    if (viewMode === 'raw') {
      try {
        setRawText(YAML.stringify(value ?? []))
      } catch (e) {}
    }
  }, [value, viewMode])

  function handleRawChange(text) {
    setRawText(text)
    try {
      const parsed = YAML.parse(text)
      setRawError(null)
      if (parsed !== undefined) {
        onChange(parsed)
      }
    } catch (err) {
      setRawError(err.message)
    }
  }

  function loadExampleSnippet() {
    if (setting?.exampleYaml) {
      handleRawChange(setting.exampleYaml)
    }
  }

  // Persistent set of candidate items ever seen (comments + default + added items)
  const [sessionCandidates, setSessionCandidates] = useState([])

  useEffect(() => {
    setSessionCandidates(prev => {
      const set = new Set(prev)
      if (candidateItems) {
        candidateItems.forEach(c => set.add(String(c)))
      }
      return Array.from(set)
    })
  }, [candidateItems])

  function addItem() {
    if (newItem.trim()) {
      const val = parseValue(newItem)
      if (!items.includes(val)) {
        onChange([...items, val])
        setSessionCandidates(prev => Array.from(new Set([...prev, String(val)])))
      }
      setNewItem('')
    }
  }

  function removeItem(idx) {
    onChange(items.filter((_, i) => i !== idx))
  }

  function updateItem(idx, val) {
    const copy = [...items]
    copy[idx] = val
    onChange(copy)
  }

  function toggleCandidate(cand) {
    const stringVal = String(cand)
    const exists = items.some(i => String(i) === stringVal)
    if (exists) {
      onChange(items.filter(i => String(i) !== stringVal))
    } else {
      onChange([...items, cand])
    }
  }

  function selectAllCandidates() {
    if (sessionCandidates.length === 0) return
    const candSet = new Set(sessionCandidates.map(String))
    const nonCandItems = items.filter(i => !candSet.has(String(i)))
    onChange([...nonCandItems, ...sessionCandidates])
  }

  function clearAll() {
    onChange([])
  }

  return (
    <div className="list-editor">
      <div className="view-mode-bar">
        <button
          type="button"
          className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
          onClick={() => setViewMode('list')}
        >
          📋 Standard Items List
        </button>
        <button
          type="button"
          className={`view-mode-btn ${viewMode === 'raw' ? 'active' : ''}`}
          onClick={() => setViewMode('raw')}
        >
          📝 Custom Raw YAML Entry
        </button>
      </div>

      {viewMode === 'raw' ? (
        <div className="raw-yaml-container">
          <div className="raw-yaml-header">
            <span className="raw-yaml-title">Custom Multi-line YAML Input</span>
            {setting?.exampleYaml && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={loadExampleSnippet}
              >
                📋 Load Example from Comments
              </button>
            )}
          </div>
          <textarea
            className="raw-yaml-textarea"
            rows={Math.max(6, (rawText.split('\n').length || 1) + 2)}
            value={rawText}
            onChange={e => handleRawChange(e.target.value)}
            placeholder={`Enter custom multi-line YAML structure...\n\nExample:\n- entrance: "REGION_A -> REGION_B"\n  exit: "REGION_C -> REGION_D"\n  direction: both`}
          />
          {rawError && (
            <div className="raw-syntax-error">
              ⚠️ Invalid YAML Syntax: {rawError}
            </div>
          )}
        </div>
      ) : (
        <>
          {sessionCandidates.length > 0 && (
            <div className="preset-chips-section">
              <div className="preset-chips-header">
                <span className="preset-chips-title">
                  💡 Valid Options & Preset Items:
                </span>
                <div className="preset-chips-actions">
                  <button type="button" className="preset-action-btn" onClick={selectAllCandidates}>
                    ✓ Select All
                  </button>
                  <button type="button" className="preset-action-btn" onClick={clearAll}>
                    ✕ Clear All
                  </button>
                </div>
              </div>
              <div className="preset-chips-grid">
                {sessionCandidates.map((cand, idx) => {
                  const isSelected = items.some(i => String(i) === String(cand))
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`chip-btn ${isSelected ? 'active' : ''}`}
                      onClick={() => toggleCandidate(cand)}
                    >
                      <span className="chip-icon">{isSelected ? '✓' : '+'}</span>
                      {cand}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {items.map((item, idx) => (
            <div key={idx} className="list-item-row">
              <input
                className="input"
                type="text"
                value={renderValue(item)}
                onChange={e => updateItem(idx, e.target.value)}
              />
              <button
                className="btn btn-danger btn-icon"
                onClick={() => removeItem(idx)}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="list-item-row">
            <input
              className="input"
              type="text"
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              placeholder="Add custom item..."
              onKeyDown={e => e.key === 'Enter' && addItem()}
            />
            <button className="btn btn-primary list-add-btn" onClick={addItem}>
              + Add
            </button>
          </div>
        </>
      )}
    </div>
  )
}


// ─── Dict Control ────────────────────────────────────────────────────────────
function DictControl({ setting, candidateItems, candidateDict, value, onChange }) {
  const dictObj = typeof value === 'object' && !Array.isArray(value) && value !== null ? value : {}
  const entries = Object.entries(dictObj)
  const [newKey, setNewKey] = useState('')
  const [newVal, setNewVal] = useState('')

  const rawCandidates = candidateDict
    ? Object.keys(candidateDict)
    : (candidateItems || [])
  const candidates = rawCandidates.filter(c => String(c).trim() !== '')

  const [viewMode, setViewMode] = useState(() => {
    if (setting?.exampleYaml) return 'raw'
    // If the dict contains nested objects, it can't be easily edited via the UI
    const hasNested = Object.values(dictObj).some(v => typeof v === 'object' && v !== null)
    if (hasNested) return 'raw'
    return 'dict'
  })

  const [rawText, setRawText] = useState(() => {
    try {
      return YAML.stringify(dictObj)
    } catch (e) {
      return ''
    }
  })
  const [rawError, setRawError] = useState(null)

  useEffect(() => {
    if (viewMode === 'raw') {
      try {
        setRawText(YAML.stringify(dictObj))
      } catch (e) {}
    }
  }, [dictObj, viewMode])

  function handleRawChange(text) {
    setRawText(text)
    try {
      const parsed = YAML.parse(text)
      setRawError(null)
      if (parsed !== undefined) {
        onChange(parsed)
      }
    } catch (err) {
      setRawError(err.message)
    }
  }

  function loadExampleSnippet() {
    if (setting?.exampleYaml) {
      handleRawChange(setting.exampleYaml)
    }
  }

  function addEntry() {
    if (newKey.trim()) {
      onChange({ ...dictObj, [newKey.trim()]: parseValue(newVal) || '1' })
      setNewKey('')
      setNewVal('')
    }
  }

  function removeEntry(key) {
    const copy = { ...dictObj }
    delete copy[key]
    onChange(copy)
  }

  function updateEntry(oldKey, newKeyStr, newValStr) {
    const copy = { ...dictObj }
    if (oldKey !== newKeyStr) {
      delete copy[oldKey]
    }
    copy[newKeyStr] = parseValue(newValStr)
    onChange(copy)
  }

  function toggleCandidateKey(candKey) {
    let defaultVal = 0
    if (candidateDict?.[candKey]) {
      const choices = candidateDict[candKey]
      defaultVal = Array.isArray(choices) ? choices[0] : choices
    }
    if (candKey in dictObj) {
      removeEntry(candKey)
    } else {
      onChange({ ...dictObj, [candKey]: defaultVal })
    }
  }

  return (
    <div className="dict-editor">
      <div className="view-mode-bar">
        <button
          type="button"
          className={`view-mode-btn ${viewMode === 'dict' ? 'active' : ''}`}
          onClick={() => setViewMode('dict')}
        >
          📋 Standard Items Dict
        </button>
        <button
          type="button"
          className={`view-mode-btn ${viewMode === 'raw' ? 'active' : ''}`}
          onClick={() => setViewMode('raw')}
        >
          📝 Custom Raw YAML Entry
        </button>
      </div>

      {viewMode === 'raw' ? (
        <div className="raw-yaml-container">
          <div className="raw-yaml-header">
            <span className="raw-yaml-title">Custom Multi-line YAML Input</span>
            {setting?.exampleYaml && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={loadExampleSnippet}
              >
                📋 Load Example from Comments
              </button>
            )}
          </div>
          <textarea
            className="raw-yaml-textarea"
            rows={Math.max(6, (rawText.split('\n').length || 1) + 2)}
            value={rawText}
            onChange={e => handleRawChange(e.target.value)}
            placeholder={`Enter custom multi-line YAML structure...\n\nExample:\nkey_name:\n  nested_key: 1\n  other_key: 0`}
          />
          {rawError && (
            <div className="raw-syntax-error">
              ⚠️ Invalid YAML Syntax: {rawError}
            </div>
          )}
        </div>
      ) : (
        <>
          {candidates.length > 0 && (
            <div className="preset-chips-section">
              <div className="preset-chips-header">
                <span className="preset-chips-title">
                  💡 Valid Options (parsed from YAML comments):
                </span>
              </div>
              <div className="preset-chips-grid">
                {candidates.map((cand, idx) => {
                  const isSelected = cand in (value || {})
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`chip-btn ${isSelected ? 'active' : ''}`}
                      onClick={() => toggleCandidateKey(cand)}
                    >
                      <span className="chip-icon">{isSelected ? '✓' : '+'}</span>
                      {cand}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {entries.map(([k, v], idx) => {
            const hasChoices = Array.isArray(candidateDict?.[k]) && candidateDict[k].length > 0
            const isKnownKey = candidateDict && k in candidateDict
            return (
              <div key={idx} className="dict-row">
                {isKnownKey ? (
                  <div className="dict-key-label" title={k}>
                    {k}
                  </div>
                ) : (
                  <input
                    className="input dict-key-input"
                    type="text"
                    value={k}
                    onChange={e => updateEntry(k, e.target.value, v)}
                    placeholder="Key"
                  />
                )}
                {hasChoices ? (
                  <select
                    className="select dict-value-select"
                    value={String(v)}
                    onChange={e => updateEntry(k, k, e.target.value)}
                  >
                    {candidateDict[k].map(choice => (
                      <option key={choice} value={choice}>
                        {choice}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input dict-value-input"
                    type="text"
                    value={renderValue(v)}
                    onChange={e => updateEntry(k, k, e.target.value)}
                    placeholder="Value"
                  />
                )}
                <button
                  className="btn btn-danger btn-icon"
                  onClick={() => removeEntry(k)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            )
          })}
          <div className="dict-row">
            <input
              className="input"
              type="text"
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              placeholder="Item name..."
            />
            <input
              className="input"
              type="text"
              value={newVal}
              onChange={e => setNewVal(e.target.value)}
              placeholder="Amount..."
              onKeyDown={e => e.key === 'Enter' && addEntry()}
            />
            <button className="btn btn-primary list-add-btn" onClick={addEntry}>
              + Add
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Scalar Control ──────────────────────────────────────────────────────────
function ScalarControl({ value, onChange }) {
  return (
    <input
      className="input"
      type="text"
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      style={{ maxWidth: 400 }}
    />
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function normalizeKey(str) {
  if (str === false) return 'false'
  if (str === true) return 'true'
  return String(str ?? '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .replace(/\b(?:random|randomize|and|or|the|of|in|to)\b/gi, '')
    .replace(/\s+/g, '')
}

function formatOptionLabel(val, setting) {
  if (val === 'true' || val === 'false') return String(val)
  if (val === undefined || val === null) return ''

  const strVal = String(val)
  const normVal = normalizeKey(strVal)

  // 1. Match against candidateItems parsed from comments (if candidate has human spaces/formatting)
  if (setting?.candidateItems) {
    const match = setting.candidateItems.find(
      c => normalizeKey(c) === normVal
    )
    if (match && match.includes(' ') && !match.includes(':')) {
      return String(match)
    }
  }


  // 4. Title case with lowercase conjunctions/prepositions
  const smallWords = new Set(['and', 'or', 'of', 'the', 'in', 'for', 'to', 'with', 'a', 'an', 'by', 'at', 'on'])
  const words = strVal.replace(/_/g, ' ').split(/\s+/)

  return words.map((w, idx) => {
    const lower = w.toLowerCase()
    if (idx > 0 && smallWords.has(lower)) {
      return lower
    }
    return lower.charAt(0).toUpperCase() + lower.slice(1)
  }).join(' ')
}

function formatDescription(desc) {
  if (!desc) return ''
  return String(desc)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/``(.*?)``/g, '$1')
}

