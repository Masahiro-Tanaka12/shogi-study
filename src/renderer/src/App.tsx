function App(): JSX.Element {
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
          onClick={() => console.log('未実装')}
          style={{
            padding: '10px 32px',
            fontSize: '16px',
            cursor: 'pointer'
          }}
        >
          棋譜を選択
        </button>
      </div>
    </div>
  )
}

export default App
