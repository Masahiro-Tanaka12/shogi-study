import { useState } from 'react'

declare global {
  interface Window {
    api: {
      selectKifuFile: () => Promise<string | null>
    }
  }
}

function App(): JSX.Element {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        margin: 0,
        fontFamily: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif"
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
        <h1 style={{ margin: 0 }}>将棋研究アプリ</h1>
        <button
          onClick={async () => {
            const path = await window.api.selectKifuFile()
            setSelectedPath(path)
          }}
          style={{
            padding: '10px 32px',
            fontSize: '16px',
            cursor: 'pointer'
          }}
        >
          棋譜を選択
        </button>
        {selectedPath && (
          <p style={{ fontSize: '14px', color: '#555', wordBreak: 'break-all', maxWidth: '600px' }}>
            {selectedPath}
          </p>
        )}
      </div>
    </div>
  )
}

export default App
