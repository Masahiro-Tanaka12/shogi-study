declare global {
  interface Window {
    api: {
      selectKifuFile: () => Promise<string | null>
    }
  }
}

const COLS = ['9', '8', '7', '6', '5', '4', '3', '2', '1']
const ROWS = ['一', '二', '三', '四', '五', '六', '七', '八', '九']

function ShogiBoard(): JSX.Element {
  return (
    <div style={{ userSelect: 'none' }}>
      <div style={{ display: 'flex', paddingLeft: '20px' }}>
        {COLS.map(c => (
          <div key={c} style={{ width: '52px', textAlign: 'center', fontSize: '12px', color: '#666' }}>
            {c}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 52px)', border: '2px solid #444' }}>
          {Array.from({ length: 81 }, (_, i) => (
            <div key={i} style={{ width: '52px', height: '56px', border: '1px solid #888', background: '#e8c87a' }} />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {ROWS.map(r => (
            <div key={r} style={{ height: '56px', display: 'flex', alignItems: 'center', paddingLeft: '6px', fontSize: '12px', color: '#666' }}>
              {r}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function App(): JSX.Element {
  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif", overflow: 'hidden' }}>
      <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f0e8' }}>
        <ShogiBoard />
      </div>
      <div style={{ width: '300px', flexShrink: 0, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #ccc', background: '#fff' }}>
        <div style={{ flex: 1, padding: '16px', borderBottom: '1px solid #ccc', overflow: 'auto' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', color: '#333' }}>棋譜リスト</h3>
          <p style={{ fontSize: '13px', color: '#999', margin: 0 }}>棋譜がありません</p>
        </div>
        <div style={{ flex: 1, padding: '16px', overflow: 'auto' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', color: '#333' }}>統計</h3>
          <p style={{ fontSize: '13px', color: '#999', margin: 0 }}>局面を選択してください</p>
        </div>
      </div>
    </div>
  )
}

export default App
