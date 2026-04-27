<template>
  <div class="settings">
    <div class="settings-inner">
      <h1>设置</h1>
      <p class="subtitle">Octo Agent 配置项</p>
      <div class="section">
        <div class="section-title">模型配置</div>
        <p class="hint">在 <code>~/.config/octo/octo.config.json</code> 中配置模型和 API Key</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  flex: 1;
  overflow-y: auto;
  padding: 40px 24px;
  background: var(--bg-app);
}
.settings-inner {
  max-width: 600px;
  margin: 0 auto;
}
h1 {
  font-size: 1.4rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.subtitle {
  color: var(--text-secondary);
  font-size: 13px;
  margin-bottom: 32px;
}
.section { margin-bottom: 24px; }
.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 10px;
}
.hint {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.hint code {
  font-family: var(--font-mono);
  font-size: 0.85em;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.1em 0.4em;
  color: var(--text-primary);
}
</style>
