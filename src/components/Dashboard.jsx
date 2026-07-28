import { useState, useRef } from 'react'
import YAML from 'yaml'
import { parseTemplate } from '../utils/yamlParser'

export default function Dashboard({ onSelectTemplate, onEditYaml, addToast }) {
  const [tab, setTab] = useState('templates') // 'templates' | 'existing'
  const [templates, setTemplates] = useState([])
  const [hasLoadedTemplates, setHasLoadedTemplates] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef(null)
  const manualFileInputRef = useRef(null)
  
  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false)

  const folderInputRef = useRef(null)

  function handleFolderFiles(e) {
    handleManualFiles(e)
  }

  function handleManualFiles(e) {
    const files = Array.from(e.target.files)
    if (files.length === 0) return
    
    setLoading(true)
    const newTemplates = []
    
    for (const file of files) {
      // If we are uploading a directory, skip files in subdirectories
      if (file.webkitRelativePath) {
        const parts = file.webkitRelativePath.split('/')
        // A direct child of the selected folder has exactly 2 parts: 'Folder/File.yaml'
        if (parts.length > 2) {
          continue
        }
      }

      if ((file.name.endsWith('.yaml') || file.name.endsWith('.yml')) && file.name !== 'meta.yaml') {
        newTemplates.push({
          filename: file.name,
          gameName: file.name.replace(/\.ya?ml$/, ''),
          size: file.size,
          file: file, // Store the File object directly
        })
      }
    }
    
    newTemplates.sort((a, b) => a.gameName.localeCompare(b.gameName))
    setTemplates(newTemplates)
    setHasLoadedTemplates(true)
    setLoading(false)
  }

  // ─── Template Selection ───────────────────────────────────────────────────────
  async function handleSelectGame(template) {
    try {
      const file = template.file || await template.handle.getFile()
      const text = await file.text()
      const parsed = parseTemplate(text)
      if (!parsed) throw new Error("Failed to parse template YAML")
      
      onSelectTemplate(parsed)
    } catch (err) {
      addToast('Failed to parse template: ' + err.message, 'error')
    }
  }

  // ─── YAML Upload (Drag & Drop + Button) ───────────────────────────────────────
  async function processUploadedFile(file) {
    try {
      const text = await file.text()
      let doc
      try {
        doc = YAML.parse(text)
      } catch (err) {
        throw new Error('Invalid YAML format: ' + err.message)
      }
      const parsed = { filename: file.name, content: doc, raw: text }

      const gameName = parsed.content?.game
      if (!gameName) {
        throw new Error('Uploaded YAML does not contain a "game" property. Cannot determine which template to load.')
      }

      // 1. Try parsing the uploaded file ITSELF as a template (preserves comments, groups, descriptions from the file)
      let templateData = parseTemplate(text)

      // 2. If uploaded file has no template settings block or comments, try matching against loaded templates
      if (!templateData || !templateData.settings || templateData.settings.length === 0) {
        const matchingTemplate = templates.find(
          t => String(t.gameName).toLowerCase() === String(gameName).toLowerCase()
        )
        if (matchingTemplate) {
          const tFile = matchingTemplate.file || await matchingTemplate.handle.getFile()
          const tText = await tFile.text()
          templateData = parseTemplate(tText)
        }
      }

      // 3. Fallback: create a minimal template structure if no comments/template structure could be parsed
      if (!templateData || !templateData.settings || templateData.settings.length === 0) {
        templateData = {
          gameName,
          name: parsed.content?.name || 'Player',
          description: parsed.content?.description || '',
          requires: parsed.content?.requires || {},
          settings: [],
        }

        const gameSettings = parsed.content[gameName] || {}
        for (const [key, val] of Object.entries(gameSettings)) {
          if (typeof val === 'object' && !Array.isArray(val) && val !== null) {
            templateData.settings.push({
              key,
              type: 'choice',
              options: Object.keys(val).map(k => ({ value: k, weight: val[k] })),
              group: 'Imported Settings',
            })
          } else if (Array.isArray(val)) {
            templateData.settings.push({ key, type: 'list', defaultValue: val, group: 'Imported Settings' })
          } else {
            templateData.settings.push({ key, type: 'scalar', defaultValue: val, group: 'Imported Settings' })
          }
        }
      }

      onEditYaml(parsed, templateData)
    } catch (err) {
      addToast('Failed to load uploaded YAML: ' + err.message, 'error')
    }
  }

  function handleUploadYaml(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = '' // clear input
    processUploadedFile(file)
  }

  // ─── Drag and Drop Handlers ───────────────────────────────────────────────────
  function handleDragOver(e) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave(e) {
    e.preventDefault()
    setIsDragging(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    setIsDragging(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0]
      if (file.name.endsWith('.yaml') || file.name.endsWith('.yml')) {
        processUploadedFile(file)
      } else {
        addToast('Please drop a valid .yaml or .yml file', 'warning')
      }
    }
  }

  const filtered = templates.filter(item => 
    item.gameName.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="spinner"></div>
        <span>Loading Archipelago data...</span>
      </div>
    )
  }

  return (
    <div 
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ minHeight: '100vh', position: 'relative' }}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="drag-overlay" style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          border: '4px dashed #3b82f6',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(4px)',
          pointerEvents: 'none',
        }}>
          <h2 style={{ color: 'white', fontSize: '2rem' }}>Drop YAML file to edit</h2>
        </div>
      )}

      <div className="dashboard-header">
        <h1 className="dashboard-title">
          <img src="./archilogo.webp" alt="Archipelago" style={{ width: '48px', height: '48px', verticalAlign: 'middle', marginRight: '12px', objectFit: 'contain' }} />
          Archipelago YAML Editor (Web)
        </h1>
        <p className="dashboard-subtitle">
          Select a game template to create a new YAML, or drop an existing configuration file anywhere on the page to edit it.
        </p>
      </div>

      {!hasLoadedTemplates ? (
        <div className="empty-state" style={{ marginTop: '4rem' }}>
          <div className="empty-state-icon">📁</div>
          <div className="empty-state-title">Load Templates Directory</div>
          <div className="empty-state-text" style={{ maxWidth: 600, margin: '0 auto 2rem auto' }}>
            To get started, please select your Archipelago Templates directory. This is usually located at:
            <br/><br/>
            <code>C:\ProgramData\Archipelago\Players\Templates</code>
          </div>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
            <button className="btn btn-primary" onClick={() => folderInputRef.current?.click()} style={{ fontSize: '1.2rem', padding: '1rem 2rem' }}>
              📂 Select Templates Folder
            </button>
            <input 
              type="file" 
              webkitdirectory="true" 
              directory="true" 
              multiple 
              ref={folderInputRef} 
              style={{ display: 'none' }} 
              onChange={handleFolderFiles} 
            />
            
            <div style={{ margin: '1rem 0', opacity: 0.7 }}>— OR —</div>
            
            <button className="btn btn-secondary" onClick={() => manualFileInputRef.current?.click()}>
              Select Files Manually (If folder is empty/unsupported)
            </button>
            <input 
              type="file" 
              multiple 
              accept=".yaml,.yml" 
              ref={manualFileInputRef} 
              style={{ display: 'none' }} 
              onChange={handleManualFiles} 
            />
          </div>
        </div>
      ) : (
        <>
          <div className="dashboard-tabs">
            <button
              className={`dashboard-tab active`}
            >
              🎮 Game Templates ({templates.length})
            </button>
          </div>

          <div className="search-bar" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <span className="search-icon">🔍</span>
              <input
                type="text"
                className="input"
                placeholder={'Search games...'}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            
            <input
              type="file"
              accept=".yaml,.yml"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleUploadYaml}
            />
            <button 
              className="btn btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              style={{ whiteSpace: 'nowrap' }}
            >
              📤 Upload Custom YAML
            </button>
          </div>

          <div className="game-grid">
            {filtered.map(t => (
              <div
                key={t.filename}
                className="card card-clickable game-card"
                onClick={() => handleSelectGame(t)}
              >
                <div className="game-card-header">
                  <span className="game-card-title">{t.gameName}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="game-card-meta">
                    {(t.size / 1024).toFixed(1)} KB
                  </span>
                  <span className="game-card-arrow">→</span>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
                <div className="empty-state-icon">🔎</div>
                <div className="empty-state-title">No games found</div>
                <div className="empty-state-text">
                  Try a different search term.
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
