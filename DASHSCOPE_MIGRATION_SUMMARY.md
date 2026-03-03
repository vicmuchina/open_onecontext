# DashScope Coding Plan Migration Summary

## Completed: March 3, 2026

### Provider Change
- **From:** Chutes API (`https://llm.chutes.ai/v1`)
- **To:** DashScope Coding Plan (`https://coding-intl.dashscope.aliyuncs.com/v1`)
- **API Key Env:** `DASHSCOPE_API_KEY`

### Benchmark Results (8 Models Tested)

| Rank | Model | Schema Rate | JSON Rate | Tokens/sec | Latency (ms) |
|------|-------|-------------|-----------|------------|--------------|
| 1 | qwen3.5-plus | 100% | 100% | 60.08 | 18,862 |
| 2 | glm-4.7 | 100% | 100% | 59.50 | 14,060 |
| 3 | **qwen3-coder-next** ⭐ | **100%** | **100%** | **42.44** | **2,841** |
| 4 | glm-5 | 100% | 100% | 26.22 | 15,990 |
| 5 | kimi-k2.5 | 100% | 100% | 24.12 | 4,974 |
| 6 | qwen3-coder-plus | 100% | 100% | 19.61 | 3,533 |
| 7 | qwen3-max-2026-01-23 | 100% | 100% | 12.59 | 4,290 |
| 8 | MiniMax-M2.5 | 67% | 100% | 41.18 | 10,093 |

### Selected Configuration

**Primary Model:** `qwen3-coder-next`
- **Why:** Lowest latency (2.8s) with 100% schema compliance
- **Critical for:** Fast watchman interruptions

**Fallback Models:**
1. `qwen3-coder-plus` (3.5s latency, 100% schema)
2. `kimi-k2.5` (5.0s latency, 100% schema)
3. `qwen3-max-2026-01-23` (4.3s latency, 100% schema)

### Configuration Files Updated

1. **`.GCC/law-enforcer.json`**
   - `critic.baseUrl`: `https://coding-intl.dashscope.aliyuncs.com/v1`
   - `critic.model`: `qwen3-coder-next`
   - `critic.modelFallbacks`: [`qwen3-coder-plus`, `kimi-k2.5`, `qwen3-max-2026-01-23`]
   - `critic.apiKeyEnv`: `DASHSCOPE_API_KEY`
   - `critic.timeoutMs`: 15000 (increased from 8000 for slower models)

2. **`.GCC/law-runtime.json`**
   - API key persisted for convenience
   - Same model configuration as law-enforcer.json

### Usage

**Set environment variable:**
```bash
export DASHSCOPE_API_KEY="sk-sp-538c754005aa4fc08d2f82331479ac05"
```

**Or use runtime config (API key already persisted in `.GCC/law-runtime.json`)**

**Verify setup:**
```bash
opencontext law validate
opencontext law status
```

### Benchmark Script Enhancement

Added `--models` flag to `scripts/chutes_json_benchmark.py` for providers without `/v1/models` endpoint:

```bash
# Example for future benchmarks
python3 scripts/chutes_json_benchmark.py \
  --base-url https://coding-intl.dashscope.aliyuncs.com/v1 \
  --api-key-env DASHSCOPE_API_KEY \
  --models "qwen3.5-plus,qwen3-coder-next,qwen3-coder-plus" \
  --response-format json_object \
  --top 3
```

### Plan Details

- **Plan:** Lite Basic Plan
- **Valid Until:** 2026-04-03 (31 days remaining)
- **Auto-Renewal:** Enabled

### Available Models (8 Total)

**Qwen Series:**
- qwen3.5-plus (Text Generation, Deep Thinking, Visual Understanding)
- qwen3-max-2026-01-23 (Text Generation, Deep Thinking)
- qwen3-coder-next (Text Generation) ⭐ **Selected**
- qwen3-coder-plus (Text Generation)

**Zhipu:**
- glm-5 (Text Generation, Deep Thinking)
- glm-4.7 (Text Generation, Deep Thinking)

**Kimi:**
- kimi-k2.5 (Text Generation, Deep Thinking, Visual Understanding)

**MiniMax:**
- MiniMax-M2.5 (Text Generation, Deep Thinking)

### Notes

- **MiniMax-M2.5** has 67% schema compliance - NOT recommended for Law Enforcer
- **qwen3-coder-next** offers best balance of speed + reliability for watchman duties
- All models except MiniMax achieved 100% JSON schema compliance
- Latency is the key differentiator for watchman interruption workflow

