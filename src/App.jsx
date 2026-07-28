import { useState, useCallback } from 'react'
import './index.css'
import Dashboard from './components/Dashboard'
import Editor from './components/Editor'
import Toast from './components/Toast'

function App() {
  const [view, setView] = useState('dashboard') // 'dashboard' | 'editor'
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [editingYaml, setEditingYaml] = useState(null) // existing YAML data to edit
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }, [])

  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template)
    setEditingYaml(null)
    setView('editor')
  }

  const handleEditYaml = (yamlData, templateData) => {
    setSelectedTemplate(templateData)
    setEditingYaml(yamlData)
    setView('editor')
  }

  const handleBack = () => {
    setView('dashboard')
    setSelectedTemplate(null)
    setEditingYaml(null)
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="app-logo" onClick={handleBack}>
          <img src="./archilogo.webp" alt="Archipelago Logo" className="app-logo-image" style={{ width: '36px', height: '36px', objectFit: 'contain' }} />
          <span className="app-logo-text">Archipelago YAML Editor</span>
          <span className="app-logo-badge">v0.6.7</span>
          {view === 'editor' && selectedTemplate?.gameName && (
            <div className="header-game-info" title={`Editing ${selectedTemplate.gameName} YAML`}>
              <span className="header-game-separator">\</span>
              <span className="header-game-title">{selectedTemplate.gameName}</span>
            </div>
          )}
        </div>
        <div className="header-actions">
          <a
            href="https://archipelago.gg/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            🌐 Archipelago.gg
          </a>
          <a
            href="https://archipelago.gg/check"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            ✅ YAML Validator
          </a>
        </div>
      </header>

      <main className="app-main">
        <div style={{ display: view === 'dashboard' ? 'block' : 'none' }}>
          <Dashboard
            onSelectTemplate={handleSelectTemplate}
            onEditYaml={handleEditYaml}
            addToast={addToast}
          />
        </div>
        {view === 'editor' && selectedTemplate && (
          <Editor
            template={selectedTemplate}
            existingYaml={editingYaml}
            onBack={handleBack}
            addToast={addToast}
          />
        )}
      </main>

      <Toast toasts={toasts} />
    </div>
  )
}

export default App
