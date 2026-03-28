import React from 'react';

const ExecutionTable = ({ executions }) => {
  if (!executions || executions.length === 0) {
    return <div style={{ color: 'var(--text-secondary)', padding: '1rem 0' }}>No execution telemetry available yet. Waiting for market divergence metrics...</div>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Network Timestamp</th>
            <th>Execution ID</th>
            <th>Target Route</th>
            <th>Expected Profit</th>
            <th>Realized MEV (Net)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {executions.map((e, i) => (
            <tr key={i}>
              <td style={{ color: 'var(--text-secondary)' }}>{new Date(e.timestamp).toLocaleTimeString()}</td>
              <td style={{ fontFamily: 'monospace', color: 'var(--accent-cyan)' }}>{e.execution_id.slice(0, 16)}...</td>
              <td>{e.route_id}</td>
              <td style={{ color: 'var(--text-secondary)' }}>${parseFloat(e.expected_net_profit_usd).toFixed(2)}</td>
              <td className={e.actual_net_profit_usd > 0 ? "glow-text-green" : ""}>
                ${parseFloat(e.actual_net_profit_usd || 0).toFixed(2)}
              </td>
              <td>
                <span style={{ 
                  backgroundColor: e.status === 'WIN' ? 'rgba(57, 255, 20, 0.1)' : 'rgba(255, 0, 60, 0.1)',
                  color: e.status === 'WIN' ? 'var(--accent-green)' : 'var(--accent-red)',
                  padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 800, letterSpacing: '1px'
                }}>
                  {e.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ExecutionTable;
