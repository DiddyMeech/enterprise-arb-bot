import React, { useEffect, useState } from 'react';
import StatCard from './components/StatCard';
import ExecutionTable from './components/ExecutionTable';
import './index.css';

function App() {
  const [stats, setStats] = useState({ totalProfitUsd: 0, totalTrades: 0, winRate: 0, uptimeHours: 0 });
  const [executions, setExecutions] = useState([]);

  const fetchData = async () => {
    try {
      const statRes = await fetch('http://localhost:9091/api/stats');
      const statData = await statRes.json();
      if (statData.status === 'success') setStats(statData.data);

      const execRes = await fetch('http://localhost:9091/api/executions');
      const execData = await execRes.json();
      if (execData.status === 'success') setExecutions(execData.data);
    } catch (e) {
      console.error("Dashboard DB fetch error:", e);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000); // Poll aggressively
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: '3rem 2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '1.5rem' }}>
        <div>
          <h1 className="glow-text-cyan" style={{ fontSize: '3rem', margin: '0', letterSpacing: '-1px' }}>TITAN 2.0</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '0.5rem 0 0 0', fontWeight: 600 }}>INSTITUTIONAL MEV TERMINAL</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--accent-green)', boxShadow: '0 0 10px var(--accent-green)' }}></div>
          <span style={{ color: 'var(--accent-green)', fontWeight: 600, letterSpacing: '1px' }}>SYSTEM LIVE</span>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
        <StatCard title="NET PROFIT (USD)" value={`$${stats.totalProfitUsd.toFixed(2)}`} highlight="green" />
        <StatCard title="TOTAL PAYLOADS" value={stats.totalTrades} />
        <StatCard title="WIN RATE" value={`${stats.winRate.toFixed(1)}%`} />
        <StatCard title="CLUSTER UPTIME (HRS)" value={stats.uptimeHours.toFixed(2)} />
      </div>

      <div className="glass-panel" style={{ padding: '2rem' }}>
        <h2 style={{ marginTop: 0, color: 'var(--text-primary)', fontWeight: 800, letterSpacing: '1px' }}>RECENT EXECUTIONS</h2>
        <ExecutionTable executions={executions} />
      </div>
    </div>
  );
}

export default App;
