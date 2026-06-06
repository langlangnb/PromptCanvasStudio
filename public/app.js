const STORAGE_KEY = "gpt-image-2-studio-settings";
const THREAD_KEY = "gpt-image-2-studio-thread";
const IMAGE_DB_NAME = "gpt-image-2-studio-assets";
const IMAGE_STORE_NAME = "generated-images";
const MAX_PERSISTED_MESSAGES = 30;
const MAX_REFERENCE_IMAGES = 8;
const MAX_GENERATION_COUNT = 20;
const SUPPORTED_REFERENCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DEFAULT_REFERENCE_TIP =
  "可直接在输入框内粘贴图片作为参考图，发送时会附带当前提示词与参考图。";
const DEFAULT_REVERSE_REFERENCE_TIP =
  "请至少粘贴 1 张图片用于反推，可额外补充你想要的语言、风格、用途或保留重点。";
const DEFAULT_ASSISTANT_SYSTEM_PROMPT = [
  "你是电商多图生图提示词优化助手。",
  "你的任务是先检查用户原始提示词是否会导致多图结果重复、同质化、只做轻微换角度。",
  "如果存在重复风险，你要主动补足差异化维度，包括但不限于视角、构图、景别、布光、场景、材质细节、功能卖点、包装展示、使用方式。",
  "必须保持同一商品身份一致，不要换商品，不要凭空新增无关主体，不要偏离用户原始需求。",
  "主图优先强调完整展示、商业清晰度、干净背景、首图可用性和转化表达。",
  "副图优先强调差异化展示，但仍要围绕同一商品输出不同卖点、不同场景和不同镜头重点。",
  "如果用户要求多图，例如 1 张主图 + 9 张副图，你必须让每张图都具备清晰区分度，避免重复构图、重复机位、重复布光和几乎一致的场景。",
  "除非用户明确要求，否则不要加入文字、logo、水印、海报排版或无关道具。",
  "每条输出提示词都必须能直接交给图片模型生成，不要输出流程说明，不要写“第几张图”这类执行话术。",
].join("\n");
const DEFAULT_REVERSE_PROMPT_SYSTEM_PROMPT = [
  "你是图片反推提示词助手。",
  "你的任务是根据用户提供的图片和补充要求，输出可直接用于生图模型的高质量提示词。",
  "优先基于图片中的可见证据描述主体、构图、景别、视角、布光、背景、材质、颜色、风格和氛围。",
  "不确定或推测性的内容必须单独列到 uncertain_points，不要混入主提示词。",
  "不要臆造品牌、商标、文字、水印内容、产品型号或图片中看不清的细节。",
  "主提示词要适合直接发给 gpt-image-2 这类图像模型使用，语义完整、具体、可执行。",
  "如果用户补充了用途，例如电商主图、海报、写实摄影、插画风格，要在结果中体现。",
  "输出必须严格遵守指定 JSON 结构，不要输出 markdown，不要解释，不要代码块。",
].join("\n");

const DEFAULT_SETTINGS = {
  endpoint: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-image-2",
  assistantModel: "gpt-5.4-mini",
  assistantSystemPrompt: DEFAULT_ASSISTANT_SYSTEM_PROMPT,
  reversePromptSystemPrompt: DEFAULT_REVERSE_PROMPT_SYSTEM_PROMPT,
  assistantReasoningEffort: "medium",
  moderation: "auto",
};

const dom = {
  thread: document.querySelector("#thread"),
  composerLabel: document.querySelector("#composerLabel"),
  composerTip: document.querySelector("#composerTip"),
  promptInput: document.querySelector("#promptInput"),
  composerForm: document.querySelector("#composerForm"),
  composerReferenceStrip: document.querySelector("#composerReferenceStrip"),
  clearReferenceImagesButton: document.querySelector("#clearReferenceImagesButton"),
  referenceTip: document.querySelector("#referenceTip"),
  composerModeGroup: document.querySelector("#composerModeGroup"),
  generateButton: document.querySelector("#generateButton"),
  pauseGenerationButton: document.querySelector("#pauseGenerationButton"),
  resumeGenerationButton: document.querySelector("#resumeGenerationButton"),
  clearThreadButton: document.querySelector("#clearThreadButton"),
  openSettingsButton: document.querySelector("#openSettingsButton"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  imagePreviewDialog: document.querySelector("#imagePreviewDialog"),
  imagePreviewTarget: document.querySelector("#imagePreviewTarget"),
  closeImagePreviewButton: document.querySelector("#closeImagePreviewButton"),
  endpointInput: document.querySelector("#endpointInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  modelInput: document.querySelector("#modelInput"),
  assistantModelInput: document.querySelector("#assistantModelInput"),
  assistantSystemPromptInput: document.querySelector("#assistantSystemPromptInput"),
  reversePromptSystemPromptInput: document.querySelector("#reversePromptSystemPromptInput"),
  assistantReasoningEffortSelect: document.querySelector("#assistantReasoningEffortSelect"),
  moderationSelect: document.querySelector("#moderationSelect"),
  qualitySelect: document.querySelector("#qualitySelect"),
  backgroundSelect: document.querySelector("#backgroundSelect"),
  outputFormatSelect: document.querySelector("#outputFormatSelect"),
  quantityInput: document.querySelector("#quantityInput"),
  ecommerceModeInput: document.querySelector("#ecommerceModeInput"),
  quantityHint: document.querySelector("#quantityHint"),
  generationModeGroup: document.querySelector("#generationModeGroup"),
  resolutionHint: document.querySelector("#resolutionHint"),
  resetSettingsButton: document.querySelector("#resetSettingsButton"),
  healthValue: document.querySelector("#healthValue"),
  modelValue: document.querySelector("#modelValue"),
  messageCountValue: document.querySelector("#messageCountValue"),
  latencyValue: document.querySelector("#latencyValue"),
  messageTemplate: document.querySelector("#messageTemplate"),
};

const state = {
  settings: loadJson(STORAGE_KEY, DEFAULT_SETTINGS),
  thread: normalizeThread(loadJson(THREAD_KEY, [])),
  composerMode: "generate",
  resolution: "1k",
  aspect: "square",
  quantity: 1,
  generationMode: "queue",
  ecommerceModeEnabled: false,
  isGenerating: false,
  activeRequestKind: null,
  referenceImages: [],
  generationSession: null,
};

const ASPECT_METADATA = {
  square: { label: "方图" },
  landscape: { label: "横图 16:9" },
  nineSixteen: { label: "竖图 9:16" },
  threeFour: { label: "3:4" },
  fourThree: { label: "4:3" },
};

const GENERATION_SIZE_MAP = {
  "1k": {
    square: "1024x1024",
    landscape: "1024x576",
    nineSixteen: "576x1024",
    threeFour: "768x1024",
    fourThree: "1024x768",
  },
  "2k": {
    square: "2048x2048",
    landscape: "2048x1152",
    nineSixteen: "1152x2048",
    threeFour: "1536x2048",
    fourThree: "2048x1536",
  },
  "4k": {
    square: "4096x4096",
    landscape: "4096x2304",
    nineSixteen: "2304x4096",
    threeFour: "3072x4096",
    fourThree: "4096x3072",
  },
};

const assetDbPromise = openAssetDatabase();

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback)) {
      return Array.isArray(parsed) ? parsed : fallback;
    }

    return parsed && typeof parsed === "object" ? { ...fallback, ...parsed } : fallback;
  } catch (error) {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to save ${key}`, error);
  }
}

function createAssetId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `asset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeReference(rawReference, index = 0) {
  if (!rawReference || typeof rawReference !== "object") {
    return {
      id: `reference-${index + 1}`,
      assetId: null,
      name: `reference-${index + 1}.png`,
      type: "image/png",
      size: 0,
      dataUrl: null,
      previewUrl: null,
      blob: null,
      assetUnavailable: false,
    };
  }

  return {
    id:
      (typeof rawReference.id === "string" && rawReference.id.trim()) ||
      (typeof rawReference.assetId === "string" && rawReference.assetId.trim()) ||
      createAssetId(),
    assetId:
      typeof rawReference.assetId === "string" && rawReference.assetId.trim()
        ? rawReference.assetId.trim()
        : null,
    name:
      (typeof rawReference.name === "string" && rawReference.name.trim()) ||
      `reference-${index + 1}.png`,
    type:
      (typeof rawReference.type === "string" && rawReference.type.trim()) || "image/png",
    size: Number.isFinite(rawReference.size) ? Math.max(0, rawReference.size) : 0,
    dataUrl:
      typeof rawReference.dataUrl === "string" && rawReference.dataUrl.startsWith("data:")
        ? rawReference.dataUrl
        : null,
    previewUrl: null,
    blob: rawReference.blob instanceof Blob ? rawReference.blob : null,
    assetUnavailable: false,
  };
}

function normalizeRetryRequest(rawRequest) {
  if (!rawRequest || typeof rawRequest !== "object") {
    return null;
  }

  return {
    prompt: typeof rawRequest.prompt === "string" ? rawRequest.prompt : "",
    controls:
      rawRequest.controls && typeof rawRequest.controls === "object"
        ? { ...rawRequest.controls }
        : null,
    executionOptions:
      rawRequest.executionOptions && typeof rawRequest.executionOptions === "object"
        ? { ...rawRequest.executionOptions }
        : null,
    references: Array.isArray(rawRequest.references)
      ? rawRequest.references.map((reference, index) => normalizeReference(reference, index))
      : [],
  };
}

function normalizeAssistPlanSnapshot(rawPlan) {
  if (!rawPlan || typeof rawPlan !== "object") {
    return null;
  }

  const groups = Array.isArray(rawPlan.groups)
    ? rawPlan.groups
        .map((group) => {
          const kind = typeof group?.kind === "string" && group.kind.trim() ? group.kind.trim() : "standard";
          const count = Math.max(0, Number(group?.count) || 0);
          if (!count) {
            return null;
          }

          return { kind, count };
        })
        .filter(Boolean)
    : [];

  const total = Math.max(
    1,
    Number(rawPlan.total) || groups.reduce((sum, group) => sum + Number(group.count || 0), 0) || 1
  );

  return {
    total,
    mode: rawPlan.mode === "ecommerce" ? "ecommerce" : "standard",
    groups,
  };
}

function normalizeAssistPromptEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry, index) => {
      const prompt = compactWhitespace(entry?.prompt || entry?.requestPrompt || "");
      if (!prompt) {
        return null;
      }

      return {
        globalIndex: Math.max(1, Number(entry?.globalIndex) || index + 1),
        kind: typeof entry?.kind === "string" && entry.kind.trim() ? entry.kind.trim() : "standard",
        prompt,
      };
    })
    .filter(Boolean);
}

function normalizeReverseMeta(meta) {
  if (!meta || typeof meta !== "object") {
    return null;
  }

  const assistantModel = String(meta.assistantModel || "").trim();
  if (!assistantModel) {
    return null;
  }

  return {
    assistantModel,
    reasoningEffort: normalizeAssistantReasoningEffort(meta.reasoningEffort),
    imageCount: Math.max(0, Number(meta.imageCount) || 0),
  };
}

function normalizeReversePromptVariants(value) {
  const items = Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : Array.isArray(value?.variants)
        ? value.variants
        : [];

  return items
    .map((entry, index) => {
      const prompt = compactWhitespace(
        entry?.prompt || entry?.text || entry?.prompt_cn || entry?.promptCn || ""
      );
      if (!prompt) {
        return null;
      }

      return {
        title: compactWhitespace(entry?.title || entry?.label || "") || `变体 ${index + 1}`,
        prompt,
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeReverseVisualBreakdown(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value)
    .map(([key, entryValue]) => [compactWhitespace(key), compactWhitespace(entryValue)])
    .filter(([key, entryValue]) => key && entryValue);

  return Object.fromEntries(entries.slice(0, 12));
}

function normalizeReversePromptResult(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const promptCn = compactWhitespace(
    value.promptCn || value.prompt_cn || value.mainPromptCn || value.main_prompt_cn || ""
  );
  const promptEn = compactWhitespace(
    value.promptEn || value.prompt_en || value.mainPromptEn || value.main_prompt_en || ""
  );
  const negativePrompt = compactWhitespace(
    value.negativePrompt || value.negative_prompt || value.negative || ""
  );
  const summary = compactWhitespace(value.summary || value.description || "");
  const styleTagsSource = Array.isArray(value.styleTags)
    ? value.styleTags
    : Array.isArray(value.style_tags)
      ? value.style_tags
      : [];
  const styleTags = styleTagsSource
    .map((entry) => compactWhitespace(entry))
    .filter(Boolean)
    .slice(0, 12);
  const uncertainPointsSource = Array.isArray(value.uncertainPoints)
    ? value.uncertainPoints
    : Array.isArray(value.uncertain_points)
      ? value.uncertain_points
      : [];
  const uncertainPoints = uncertainPointsSource
    .map((entry) => compactWhitespace(entry))
    .filter(Boolean)
    .slice(0, 10);
  const visualBreakdown = normalizeReverseVisualBreakdown(
    value.visualBreakdown || value.visual_breakdown
  );
  const variants = normalizeReversePromptVariants(value.variants);

  if (!promptCn && !promptEn && !variants.length) {
    return null;
  }

  return {
    summary,
    promptCn,
    promptEn,
    negativePrompt,
    styleTags,
    visualBreakdown,
    uncertainPoints,
    variants,
  };
}

function normalizeBatchGroupId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeBatchGroupCount(value, fallback = 1) {
  return Math.max(1, Number(value) || fallback || 1);
}

function normalizeThread(rawThread) {
  if (!Array.isArray(rawThread)) {
    return [];
  }

  return rawThread.map((item) => ({
    role: item?.role || "assistant",
    type: item?.type || "text",
    text: typeof item?.text === "string" ? item.text : "",
    caption: typeof item?.caption === "string" ? item.caption : "",
    time: typeof item?.time === "string" ? item.time : "",
    requestSize: item?.requestSize || item?.nativeSize || null,
    resultSize: item?.resultSize || item?.exportSize || null,
    legacySizeRecord: Boolean(
      item?.legacySizeRecord ||
        ((!item?.requestSize || !item?.resultSize) && (item?.nativeSize || item?.exportSize))
    ),
    outputFormat: item?.outputFormat || null,
    filename: item?.filename || null,
    diagnostics: item?.diagnostics || null,
    retryRequest: normalizeRetryRequest(item?.retryRequest),
    assistState: typeof item?.assistState === "string" ? item.assistState : null,
    assistStage: typeof item?.assistStage === "string" ? item.assistStage : null,
    assistMeta: normalizeAssistantMeta(item?.assistMeta),
    assistPlan: normalizeAssistPlanSnapshot(item?.assistPlan),
    assistPrompts: normalizeAssistPromptEntries(item?.assistPrompts),
    reverseState: typeof item?.reverseState === "string" ? item.reverseState : null,
    reverseStage: typeof item?.reverseStage === "string" ? item.reverseStage : null,
    reverseMeta: normalizeReverseMeta(item?.reverseMeta),
    reverseResult: normalizeReversePromptResult(item?.reverseResult),
    batchGroupId: normalizeBatchGroupId(item?.batchGroupId),
    batchGroupIndex: Number(item?.batchGroupIndex) > 0 ? Number(item.batchGroupIndex) : null,
    batchGroupTotal:
      Number(item?.batchGroupTotal) > 0 ? Number(item.batchGroupTotal) : item?.batchGroupId ? 1 : null,
    batchKind: typeof item?.batchKind === "string" && item.batchKind.trim() ? item.batchKind.trim() : null,
    batchKindIndex: Number(item?.batchKindIndex) > 0 ? Number(item.batchKindIndex) : null,
    batchKindCount: Number(item?.batchKindCount) > 0 ? Number(item.batchKindCount) : null,
    assistExpanded:
      item?.assistExpanded === false
        ? false
        : item?.assistExpanded === true
          ? true
          : item?.assistState === "complete"
            ? false
            : item?.type === "assist",
    reverseExpanded:
      item?.reverseExpanded === false
        ? false
        : item?.reverseExpanded === true
          ? true
          : item?.reverseState === "complete"
            ? false
            : item?.type === "reverse",
    assetId: item?.assetId || null,
    references: Array.isArray(item?.references)
      ? item.references.map((reference, index) => normalizeReference(reference, index))
      : [],
    previewUrl: null,
    downloadUrl: null,
    assetUnavailable: false,
  }));
}

function cloneReference(reference) {
  return {
    id: reference.id || createAssetId(),
    assetId: reference.assetId || null,
    name: reference.name || "reference.png",
    type: reference.type || "image/png",
    size: Number.isFinite(reference.size) ? reference.size : 0,
    dataUrl: reference.dataUrl || null,
    previewUrl: reference.previewUrl || null,
    blob: reference.blob instanceof Blob ? reference.blob : null,
    assetUnavailable: Boolean(reference.assetUnavailable),
  };
}

function cloneReferenceList(referenceList) {
  return Array.isArray(referenceList) ? referenceList.map(cloneReference) : [];
}

function serializeReference(reference) {
  return {
    assetId: reference.assetId || null,
    name: reference.name || "reference.png",
    type: reference.type || "image/png",
    size: Number.isFinite(reference.size) ? reference.size : 0,
    dataUrl: reference.assetId ? null : reference.dataUrl || null,
  };
}

function serializeRetryRequest(retryRequest) {
  if (!retryRequest) {
    return null;
  }

  return {
    prompt: retryRequest.prompt || "",
    controls: retryRequest.controls ? { ...retryRequest.controls } : null,
    executionOptions: retryRequest.executionOptions ? { ...retryRequest.executionOptions } : null,
    references: cloneReferenceList(retryRequest.references).map(serializeReference),
  };
}

function nowLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function formatDuration(ms) {
  const safeMs = Math.max(0, Math.round(Number(ms) || 0));
  if (safeMs < 1000) {
    return `${safeMs} ms`;
  }

  return `${(safeMs / 1000).toFixed(safeMs >= 10000 ? 1 : 2)} s`;
}

function formatBytes(size) {
  const safeSize = Math.max(0, Number(size) || 0);
  if (!safeSize) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(safeSize) / Math.log(1024)), units.length - 1);
  const value = safeSize / 1024 ** unitIndex;
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function truncateText(value, limit = 220) {
  const text = String(value || "").trim();
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit)}...`;
}

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setActiveSegment(groupId, attributeName, value) {
  const dataAttribute = String(attributeName || "").replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
  const datasetKey = String(attributeName || "").replace(/-([a-z])/g, (_, char) => char.toUpperCase());
  document.querySelectorAll(`#${groupId} [data-${dataAttribute}]`).forEach((button) => {
    button.classList.toggle("is-active", button.dataset[datasetKey] === value);
  });
}

function clampGenerationCount(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(MAX_GENERATION_COUNT, Math.max(1, parsed));
}

function normalizeAssistantReasoningEffort(value) {
  return ["low", "medium", "high"].includes(value) ? value : DEFAULT_SETTINGS.assistantReasoningEffort;
}

function normalizeAssistantSystemPrompt(value) {
  const prompt = String(value || "").trim();
  return prompt || DEFAULT_SETTINGS.assistantSystemPrompt;
}

function normalizeReversePromptSystemPrompt(value) {
  const prompt = String(value || "").trim();
  return prompt || DEFAULT_SETTINGS.reversePromptSystemPrompt;
}

function normalizeComposerMode(value) {
  return value === "reverse" ? "reverse" : "generate";
}

function parseCountFromPrompt(prompt) {
  const text = String(prompt || "").trim();
  if (!text) {
    return null;
  }

  const mainSubMatch = text.match(/(\d+)\s*张?\s*主图\s*[+＋]\s*(\d+)\s*张?\s*副图/i);
  if (mainSubMatch) {
    return clampGenerationCount(Number(mainSubMatch[1]) + Number(mainSubMatch[2]));
  }

  const mainOnlyMatch = text.match(/主图\s*(\d+)\s*张|(\d+)\s*张?\s*主图/i);
  const subOnlyMatch = text.match(/副图\s*(\d+)\s*张|(\d+)\s*张?\s*副图/i);
  if (mainOnlyMatch || subOnlyMatch) {
    const mainCount = Number(mainOnlyMatch?.[1] || mainOnlyMatch?.[2] || 0);
    const subCount = Number(subOnlyMatch?.[1] || subOnlyMatch?.[2] || 0);
    const total = mainCount + subCount;
    if (total > 0) {
      return clampGenerationCount(total);
    }
  }

  const genericMatches = [...text.matchAll(/(\d+)\s*张/g)];
  if (genericMatches.length) {
    return clampGenerationCount(genericMatches[genericMatches.length - 1][1]);
  }

  return null;
}

function resolveRequestedCount(prompt, manualCount = state.quantity) {
  const promptCount = parseCountFromPrompt(prompt);
  if (promptCount) {
    return {
      count: promptCount,
      source: "prompt",
    };
  }

  return {
    count: clampGenerationCount(manualCount),
    source: "manual",
  };
}

function describeQuantitySource(source, count) {
  return source === "prompt"
    ? `提示词已指定数量，本次按 ${count} 张执行。`
    : `当前按手动数量 ${count} 张执行。`;
}

function extractKeywordCount(prompt, keyword) {
  const text = String(prompt || "").trim();
  if (!text) {
    return 0;
  }

  const pattern = new RegExp(`(\\d+)\\s*张?\\s*${keyword}|${keyword}\\s*(\\d+)\\s*张?`, "gi");
  const matches = [...text.matchAll(pattern)];
  if (!matches.length) {
    return 0;
  }

  const latest = matches[matches.length - 1];
  return clampGenerationCount(Number(latest[1] || latest[2] || 0));
}

function buildDefaultEcommerceGroups(total) {
  const safeTotal = clampGenerationCount(total);
  if (safeTotal <= 1) {
    return [{ kind: "main", count: 1 }];
  }

  return [
    { kind: "main", count: 1 },
    { kind: "sub", count: safeTotal - 1 },
  ];
}

function buildGenerationPlan(prompt, manualCount = state.quantity, options = {}) {
  const ecommerceModeEnabled = Boolean(options.ecommerceModeEnabled);
  const mainCount = extractKeywordCount(prompt, "主图");
  const subCount = extractKeywordCount(prompt, "副图");

  if (mainCount || subCount) {
    const total = clampGenerationCount(mainCount + subCount);
    const groups = [];
    let remaining = total;

    if (mainCount && remaining > 0) {
      const count = Math.min(mainCount, remaining);
      groups.push({ kind: "main", count });
      remaining -= count;
    }

    if (subCount && remaining > 0) {
      const count = Math.min(subCount, remaining);
      groups.push({ kind: "sub", count });
      remaining -= count;
    }

    return {
      total,
      source: "prompt",
      mode: "ecommerce",
      groups,
      ecommerceDerived: false,
    };
  }

  const { count, source } = resolveRequestedCount(prompt, manualCount);
  if (ecommerceModeEnabled && count > 1) {
    return {
      total: count,
      source,
      mode: "ecommerce",
      groups: buildDefaultEcommerceGroups(count),
      ecommerceDerived: true,
    };
  }

  return {
    total: count,
    source,
    mode: "standard",
    groups: [{ kind: "standard", count }],
    ecommerceDerived: false,
  };
}

function buildGenerationQueue(plan) {
  const queue = [];
  let globalIndex = 0;
  const batchGroupId = Number(plan?.total || 0) > 1 ? `batch-${createAssetId()}` : null;

  for (const group of plan.groups || []) {
    for (let kindIndex = 1; kindIndex <= group.count; kindIndex += 1) {
      globalIndex += 1;
      queue.push({
        kind: group.kind,
        kindIndex,
        kindCount: group.count,
        globalIndex,
        total: plan.total,
        batchGroupId,
      });
    }
  }

  return queue;
}

function formatBatchItemLabel(item) {
  if (!item || item.total <= 1) {
    return "";
  }

  if (item.kind === "main") {
    return `主图 ${item.kindIndex}/${item.kindCount} · 全套 ${item.globalIndex}/${item.total}`;
  }

  if (item.kind === "sub") {
    return `副图 ${item.kindIndex}/${item.kindCount} · 全套 ${item.globalIndex}/${item.total}`;
  }

  return `第 ${item.globalIndex}/${item.total} 张`;
}

function buildPromptForBatchItem(prompt, item) {
  if (typeof item?.promptOverride === "string" && item.promptOverride.trim()) {
    return item.promptOverride.trim();
  }

  const cleanPrompt = String(prompt || "").trim();
  if (!item || item.total <= 1) {
    return cleanPrompt;
  }

  const lines = [
    cleanPrompt,
    "",
    `Batch requirement: this is image ${item.globalIndex} of ${item.total}.`,
  ];

  if (item.kind === "main") {
    lines.push(
      "Generate the main e-commerce hero image for the product. Prioritize complete product visibility, clean composition, commercial clarity, and strong listing appeal."
    );
  } else if (item.kind === "sub") {
    lines.push(
      "Generate an auxiliary e-commerce gallery image for the same product. Keep the same product identity, but vary angle, detail focus, scene, usage, packaging, or selling point from the hero image."
    );
  } else {
    lines.push(
      "Generate a distinct variation from the same prompt. Keep the core subject consistent, but vary composition, angle, framing, scene, or lighting so each image is meaningfully different."
    );
  }

  return lines.join("\n").trim();
}

function updateQuantityHint(prompt = dom.promptInput?.value || "") {
  if (!dom.quantityHint) {
    return;
  }

  const plan = buildGenerationPlan(prompt, state.quantity, {
    ecommerceModeEnabled: state.ecommerceModeEnabled,
  });
  const parts = [describeQuantitySource(plan.source, plan.total)];
  const generationMode = normalizeGenerationMode(state.generationMode);

  if (plan.mode === "ecommerce") {
    const mainCount = plan.groups.find((group) => group.kind === "main")?.count || 0;
    const subCount = plan.groups.find((group) => group.kind === "sub")?.count || 0;
    if (plan.ecommerceDerived) {
      parts.push(`电商模式已启用，默认按主图 ${mainCount} 张、副图 ${subCount} 张规划。`);
    } else {
      parts.push(`已识别主图 ${mainCount} 张、副图 ${subCount} 张。`);
    }
  }

  if (plan.total > 1) {
    parts.push(
      generationMode === "parallel"
        ? "将并行发起多张请求，完成顺序可能不同，且不支持暂停 / 恢复。"
        : "将按同一提示词顺序排队生成多张变体。"
    );
  }

  parts.push("可输入 1-20，也可在提示词里直接写“10张”或“1张主图+9张副图”。");
  dom.quantityHint.textContent = parts.join(" ");
}

function updateStatus() {
  dom.modelValue.textContent = state.settings.model || "gpt-image-2";
  dom.messageCountValue.textContent = String(state.thread.length);
  const requestSize = getGenerationSize(state.resolution, state.aspect);
  dom.resolutionHint.textContent = `发送给模型的生成尺寸: ${requestSize}。1K / 2K / 4K 会直接改变请求像素。`;
  if (dom.quantityInput) {
    dom.quantityInput.value = String(clampGenerationCount(state.quantity));
  }
  if (dom.ecommerceModeInput) {
    dom.ecommerceModeInput.checked = Boolean(state.ecommerceModeEnabled);
  }
  updateComposerModeUi();
  updateQuantityHint();
  updateGenerationControls();
}

function getAspectLabel(aspect) {
  return ASPECT_METADATA[normalizeAspect(aspect)]?.label || "方图";
}

function getGenerationSize(resolution, aspect) {
  const normalizedResolution = ["1k", "2k", "4k"].includes(resolution) ? resolution : "1k";
  const normalizedAspect = normalizeAspect(aspect);
  return (
    GENERATION_SIZE_MAP[normalizedResolution]?.[normalizedAspect] ||
    GENERATION_SIZE_MAP["1k"].square
  );
}

function normalizeAspect(aspect) {
  if (aspect === "portrait") {
    return "nineSixteen";
  }

  return Object.prototype.hasOwnProperty.call(ASPECT_METADATA, aspect) ? aspect : "square";
}

function normalizeGenerationMode(mode) {
  return mode === "parallel" ? "parallel" : "queue";
}

function getGenerationModeLabel(mode) {
  return normalizeGenerationMode(mode) === "parallel" ? "并行生成" : "排队生成";
}

function getEcommerceModeLabel(enabled, plan) {
  if (!enabled || !plan || plan.total <= 1) {
    return "";
  }

  return plan.mode === "ecommerce" ? "电商多图" : "多图";
}

function formatAssistantSummary(model, reasoningEffort) {
  const cleanModel = String(model || "").trim();
  if (!cleanModel) {
    return "";
  }

  const effort = normalizeAssistantReasoningEffort(reasoningEffort);
  return `辅助提示词 ${cleanModel} / ${effort}`;
}

function formatReverseSummary(model, reasoningEffort) {
  const cleanModel = String(model || "").trim();
  if (!cleanModel) {
    return "";
  }

  const effort = normalizeAssistantReasoningEffort(reasoningEffort);
  return `图片反推 ${cleanModel} / ${effort}`;
}

function setReferenceTip(message, tone = "default") {
  if (!dom.referenceTip) {
    return;
  }

  dom.referenceTip.textContent = message;
  dom.referenceTip.dataset.tone = tone;
}

function getActivePrimaryPrompt(result) {
  return (
    compactWhitespace(result?.promptCn || "") ||
    compactWhitespace(result?.promptEn || "") ||
    compactWhitespace(result?.variants?.[0]?.prompt || "")
  );
}

function updateComposerModeUi() {
  const mode = normalizeComposerMode(state.composerMode);
  if (dom.composerModeGroup) {
    setActiveSegment("composerModeGroup", "composerMode", mode);
  }

  if (dom.composerLabel) {
    dom.composerLabel.textContent =
      mode === "reverse" ? "粘贴或上传要反推的图片，可补充反推要求" : "输入你要生成的画面描述";
  }

  if (dom.promptInput) {
    dom.promptInput.placeholder =
      mode === "reverse"
        ? "例如：请按中文输出可直接生图的提示词，偏电商主图风格，保留材质与灯光，忽略水印和文字。"
        : "例如：低饱和胶片风格的室内建筑摄影，晨雾穿过长窗，木质陈列架上摆放极简陶瓷。也可以先粘贴一张参考图，再补充你要保留和改变的部分。";
  }

  if (dom.composerTip) {
    dom.composerTip.textContent =
      mode === "reverse"
        ? "Shift + Enter 换行，Enter 发送。反推模式至少需要 1 张图片，可附加文本要求。"
        : "Shift + Enter 换行，Enter 发送。支持在输入框内直接粘贴图片。";
  }

  updateReferenceUi();
}

function setComposerMode(mode, { focus = false } = {}) {
  state.composerMode = normalizeComposerMode(mode);
  updateComposerModeUi();
  if (focus) {
    dom.promptInput?.focus();
  }
}

function updateReferenceUi() {
  const count = state.referenceImages.length;
  if (dom.clearReferenceImagesButton) {
    dom.clearReferenceImagesButton.disabled = count === 0;
  }

  if (!count) {
    setReferenceTip(
      normalizeComposerMode(state.composerMode) === "reverse"
        ? DEFAULT_REVERSE_REFERENCE_TIP
        : DEFAULT_REFERENCE_TIP
    );
    if (dom.composerReferenceStrip) {
      dom.composerReferenceStrip.hidden = true;
    }
    return;
  }

  setReferenceTip(
    normalizeComposerMode(state.composerMode) === "reverse"
      ? `已附加 ${count} 张待反推图片，发送时会附带当前图片与补充要求。`
      : `已附加 ${count} 张参考图，发送时会附带当前提示词与参考图。`
  );
  if (dom.composerReferenceStrip) {
    dom.composerReferenceStrip.hidden = false;
  }
}

function openAssetDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const request = window.indexedDB.open(IMAGE_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        db.createObjectStore(IMAGE_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn("Failed to open image cache database.", request.error);
      resolve(null);
    };
  });
}

function waitForTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Transaction aborted."));
  });
}

function waitForRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Request failed."));
  });
}

async function putBinaryAsset(assetId, blob) {
  const db = await assetDbPromise;
  if (!db || !assetId || !(blob instanceof Blob)) {
    return false;
  }

  try {
    const transaction = db.transaction(IMAGE_STORE_NAME, "readwrite");
    transaction.objectStore(IMAGE_STORE_NAME).put({
      id: assetId,
      blob,
      updatedAt: Date.now(),
    });
    await waitForTransaction(transaction);
    return true;
  } catch (error) {
    console.warn("Failed to cache asset.", error);
    return false;
  }
}

async function getBinaryAsset(assetId) {
  if (!assetId) {
    return null;
  }

  const db = await assetDbPromise;
  if (!db) {
    return null;
  }

  try {
    const transaction = db.transaction(IMAGE_STORE_NAME, "readonly");
    const request = transaction.objectStore(IMAGE_STORE_NAME).get(assetId);
    const record = await waitForRequest(request);
    await waitForTransaction(transaction);
    return record?.blob || null;
  } catch (error) {
    console.warn("Failed to read cached asset.", error);
    return null;
  }
}

async function deleteBinaryAssets(assetIds) {
  const uniqueIds = [...new Set((assetIds || []).filter(Boolean))];
  if (!uniqueIds.length) {
    return;
  }

  const db = await assetDbPromise;
  if (!db) {
    return;
  }

  try {
    const transaction = db.transaction(IMAGE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(IMAGE_STORE_NAME);
    for (const assetId of uniqueIds) {
      store.delete(assetId);
    }
    await waitForTransaction(transaction);
  } catch (error) {
    console.warn("Failed to delete cached assets.", error);
  }
}

function collectReferenceAssetIds(referenceList) {
  return (referenceList || []).map((reference) => reference?.assetId).filter(Boolean);
}

function collectThreadAssetIds(threadSnapshot) {
  const keepIds = new Set();

  for (const item of threadSnapshot || []) {
    if (item?.assetId) {
      keepIds.add(item.assetId);
    }

    for (const assetId of collectReferenceAssetIds(item?.references)) {
      keepIds.add(assetId);
    }

    for (const assetId of collectReferenceAssetIds(item?.retryRequest?.references)) {
      keepIds.add(assetId);
    }
  }

  return [...keepIds];
}

async function pruneBinaryAssets(threadSnapshot) {
  const db = await assetDbPromise;
  if (!db) {
    return;
  }

  const keepIds = new Set(collectThreadAssetIds(threadSnapshot));

  try {
    const readTransaction = db.transaction(IMAGE_STORE_NAME, "readonly");
    const keys = await waitForRequest(readTransaction.objectStore(IMAGE_STORE_NAME).getAllKeys());
    await waitForTransaction(readTransaction);

    const staleIds = keys.filter((key) => !keepIds.has(key));
    if (staleIds.length) {
      await deleteBinaryAssets(staleIds);
    }
  } catch (error) {
    console.warn("Failed to prune cached assets.", error);
  }
}

function revokeObjectUrl(url) {
  if (typeof url === "string" && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function revokeReferenceObjectUrl(reference) {
  if (!reference) {
    return;
  }

  revokeObjectUrl(reference.previewUrl);
  reference.previewUrl = null;
}

function revokeReferenceListObjectUrls(referenceList) {
  for (const reference of referenceList || []) {
    revokeReferenceObjectUrl(reference);
  }
}

function revokeMessageObjectUrls(message) {
  const urls = [message?.previewUrl, message?.downloadUrl];
  for (const url of new Set(urls)) {
    revokeObjectUrl(url);
  }

  if (message) {
    message.previewUrl = null;
    message.downloadUrl = null;
  }
}

function revokeThreadMessageAssets(message) {
  revokeMessageObjectUrls(message);
  revokeReferenceListObjectUrls(message?.references);
}

function attachBlobUrls(message, blob) {
  if (!message || !(blob instanceof Blob)) {
    return;
  }

  revokeMessageObjectUrls(message);
  const objectUrl = URL.createObjectURL(blob);
  message.previewUrl = objectUrl;
  message.downloadUrl = objectUrl;
  message.assetUnavailable = false;
}

async function hydrateReferenceList(referenceList) {
  await Promise.all(
    (referenceList || []).map(async (reference) => {
      revokeReferenceObjectUrl(reference);
      reference.assetUnavailable = false;

      if (reference.blob instanceof Blob) {
        reference.previewUrl = URL.createObjectURL(reference.blob);
        return;
      }

      if (reference.assetId) {
        const blob = await getBinaryAsset(reference.assetId);
        if (blob) {
          reference.blob = blob;
          reference.previewUrl = URL.createObjectURL(blob);
          return;
        }
      }

      if (reference.dataUrl) {
        reference.previewUrl = reference.dataUrl;
        return;
      }

      reference.assetUnavailable = true;
    })
  );
}

async function hydrateThreadAssets() {
  await Promise.all(
    state.thread.map(async (item) => {
      if (item.type === "image") {
        revokeMessageObjectUrls(item);
        item.assetUnavailable = false;

        if (item.assetId) {
          const blob = await getBinaryAsset(item.assetId);
          if (blob) {
            attachBlobUrls(item, blob);
          } else {
            item.assetUnavailable = true;
          }
        }
      }

      if (item.references?.length) {
        await hydrateReferenceList(item.references);
      }
    })
  );
}

function serializeThreadItem(item) {
  return {
    role: item.role,
    type: item.type,
    text: item.text,
    caption: item.caption,
    time: item.time,
    requestSize: item.requestSize || null,
    resultSize: item.resultSize || null,
    legacySizeRecord: Boolean(item.legacySizeRecord),
    outputFormat: item.outputFormat,
    filename: item.filename,
    diagnostics: item.diagnostics,
    retryRequest: serializeRetryRequest(item.retryRequest),
    batchGroupId: item.batchGroupId || null,
    batchGroupIndex: item.batchGroupIndex || null,
    batchGroupTotal: item.batchGroupTotal || null,
    batchKind: item.batchKind || null,
    batchKindIndex: item.batchKindIndex || null,
    batchKindCount: item.batchKindCount || null,
    assistState: item.assistState || null,
    assistStage: item.assistStage || null,
    assistMeta: item.assistMeta ? { ...item.assistMeta } : null,
    assistPlan: item.assistPlan
      ? {
          total: item.assistPlan.total || null,
          mode: item.assistPlan.mode || null,
          groups: Array.isArray(item.assistPlan.groups)
            ? item.assistPlan.groups.map((group) => ({
                kind: group.kind || "standard",
                count: Math.max(0, Number(group.count) || 0),
              }))
            : [],
        }
      : null,
    assistPrompts: normalizeAssistPromptEntries(item.assistPrompts),
    assistExpanded: Boolean(item.assistExpanded),
    reverseState: item.reverseState || null,
    reverseStage: item.reverseStage || null,
    reverseMeta: item.reverseMeta ? { ...item.reverseMeta } : null,
    reverseResult: item.reverseResult ? { ...item.reverseResult } : null,
    reverseExpanded: Boolean(item.reverseExpanded),
    assetId: item.assetId || null,
    references: cloneReferenceList(item.references).map(serializeReference),
  };
}

async function persistThread() {
  const trimmedThread = state.thread.slice(-MAX_PERSISTED_MESSAGES);
  const removedItems = state.thread.slice(0, Math.max(0, state.thread.length - trimmedThread.length));

  if (removedItems.length) {
    for (const item of removedItems) {
      revokeThreadMessageAssets(item);
    }
    state.thread = trimmedThread;
  }

  const compactThread = state.thread.map(serializeThreadItem);
  saveJson(THREAD_KEY, compactThread);
  await pruneBinaryAssets(compactThread);
  updateStatus();
}

async function addMessage(message) {
  state.thread.push(message);
  await persistThread();
  renderThread();
  return state.thread.length - 1;
}

async function updateThreadMessageAt(index, patch) {
  if (!Number.isInteger(index) || index < 0 || index >= state.thread.length) {
    return;
  }

  const previous = state.thread[index];
  const shouldRevokeImageUrls =
    Boolean(patch.previewUrl || patch.downloadUrl) ||
    Boolean((patch.type && patch.type !== "image") || patch.assetUnavailable);

  if (shouldRevokeImageUrls) {
    revokeMessageObjectUrls(previous);
  }

  state.thread[index] = {
    ...previous,
    ...patch,
  };

  await persistThread();
  renderThread();
}

async function updateLastMessage(patch) {
  if (!state.thread.length) {
    return;
  }

  await updateThreadMessageAt(state.thread.length - 1, patch);
}

async function clearThread() {
  const assetIds = collectThreadAssetIds(state.thread);
  for (const item of state.thread) {
    revokeThreadMessageAssets(item);
  }

  state.thread = [];
  await deleteBinaryAssets(assetIds);
  await persistThread();
  renderThread();
}

function formatRequestSummary(message) {
  const parts = [];

  if (message.aspectLabel) {
    parts.push(message.aspectLabel);
  }
  if (message.resolutionLabel) {
    parts.push(message.resolutionLabel);
  }
  if (message.outputFormat) {
    parts.push(message.outputFormat.toUpperCase());
  }
  if (message.referenceCount) {
    parts.push(`${message.referenceCount} 张参考图`);
  }
  if (message.quantityLabel) {
    parts.push(message.quantityLabel);
  }
  if (message.generationModeLabel) {
    parts.push(message.generationModeLabel);
  }
  if (message.ecommerceModeLabel) {
    parts.push(message.ecommerceModeLabel);
  }
  if (message.assistantSummary) {
    parts.push(message.assistantSummary);
  }

  return parts.join(" / ");
}

function buildAssistPlanLabel(plan) {
  if (!plan) {
    return "";
  }

  const groups = Array.isArray(plan.groups) ? plan.groups : [];
  const mainCount = groups.find((group) => group.kind === "main")?.count || 0;
  const subCount = groups.find((group) => group.kind === "sub")?.count || 0;
  const total = Math.max(1, Number(plan.total) || mainCount + subCount || groups.length || 1);
  const parts = [];

  if (mainCount) {
    parts.push(`主图 ${mainCount} 张`);
  }
  if (subCount) {
    parts.push(`副图 ${subCount} 张`);
  }
  if (!parts.length) {
    parts.push(`共 ${total} 张`);
  } else {
    parts.push(`共 ${total} 张`);
  }

  return parts.join(" / ");
}

function getAssistKindLabel(kind) {
  if (kind === "main") {
    return "主图";
  }
  if (kind === "sub") {
    return "副图";
  }
  return "图片";
}

function getAssistStateLabel(stateValue) {
  if (stateValue === "complete") {
    return "已完成";
  }
  if (stateValue === "failed") {
    return "已回退";
  }
  return "优化中";
}

function getAssistStageText(stageValue, meta) {
  const summary = meta ? formatAssistantSummary(meta.assistantModel, meta.reasoningEffort) : "辅助模型";

  if (stageValue === "complete") {
    return `${summary} 已返回差异化子提示词。`;
  }
  if (stageValue === "fallback") {
    return `${summary} 优化失败，系统已回退到原始多图提示词。`;
  }

  return `${summary} 正在分析主图/副图计划并生成差异化子提示词。`;
}

function buildAssistProgressMessage({
  assistState = "pending",
  assistStage = "requesting",
  assistMeta = null,
  assistPlan = null,
  assistPrompts = [],
  diagnostics = null,
}) {
  const normalizedMeta = normalizeAssistantMeta(assistMeta);
  const normalizedPlan = normalizeAssistPlanSnapshot(assistPlan);
  const normalizedPrompts = normalizeAssistPromptEntries(assistPrompts);
  const isCompleted = assistState === "complete";
  const isFailed = assistState === "failed";

  let text = "辅助模型正在优化多图提示词。";
  if (isCompleted) {
    text = `辅助模型已完成提示词优化，生成了 ${normalizedPrompts.length || normalizedPlan?.total || 0} 条差异化提示词。`;
  } else if (isFailed) {
    text = "辅助模型提示词优化失败，已回退到原始多图生成逻辑。";
  }

  const captionParts = [];
  if (normalizedMeta) {
    captionParts.push(
      formatAssistantSummary(normalizedMeta.assistantModel, normalizedMeta.reasoningEffort)
    );
  }
  if (normalizedPlan) {
    captionParts.push(buildAssistPlanLabel(normalizedPlan));
  }

  return {
    role: "assistant",
    type: "assist",
    text,
    caption: captionParts.join(" / "),
    diagnostics,
    retryRequest: null,
    assistState,
    assistStage,
    assistMeta: normalizedMeta,
    assistPlan: normalizedPlan,
    assistPrompts: normalizedPrompts,
    assistExpanded: !isCompleted,
    requestSize: null,
    resultSize: null,
    legacySizeRecord: false,
    outputFormat: null,
    filename: null,
    assetId: null,
    assetUnavailable: false,
    previewUrl: null,
    downloadUrl: null,
    time: nowLabel(),
  };
}

function renderParagraph(text) {
  const p = document.createElement("p");
  p.textContent = text;
  return p;
}

function renderMutedParagraph(text) {
  const p = document.createElement("p");
  p.className = "message-caption";
  p.textContent = text;
  return p;
}

function renderAssistPromptList(prompts) {
  const entries = normalizeAssistPromptEntries(prompts);
  if (!entries.length) {
    return null;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "assist-prompt-list";

  entries.forEach((entry) => {
    const item = document.createElement("article");
    item.className = "assist-prompt-item";

    const heading = document.createElement("div");
    heading.className = "assist-prompt-heading";
    heading.textContent = `${getAssistKindLabel(entry.kind)} ${entry.globalIndex}`;

    const content = document.createElement("p");
    content.className = "assist-prompt-text";
    content.textContent = entry.prompt;

    item.append(heading, content);
    wrapper.append(item);
  });

  return wrapper;
}

function persistAssistExpandedState(index, expanded) {
  if (!Number.isInteger(index) || index < 0 || index >= state.thread.length) {
    return;
  }

  state.thread[index] = {
    ...state.thread[index],
    assistExpanded: Boolean(expanded),
  };
  void persistThread();
}

function renderAssistMessage(item, itemIndex) {
  const details = document.createElement("details");
  details.className = `assist-details is-${item.assistState || "pending"}`;
  details.open = item.assistExpanded !== false;
  details.addEventListener("toggle", () => {
    persistAssistExpandedState(itemIndex, details.open);
  });

  const summary = document.createElement("summary");
  summary.className = "assist-summary";

  const summaryMain = document.createElement("div");
  summaryMain.className = "assist-summary-main";

  const title = document.createElement("span");
  title.className = "assist-summary-title";
  title.textContent = item.text || "辅助模型提示词优化";

  const metaLine = document.createElement("span");
  metaLine.className = "assist-summary-meta";
  metaLine.textContent = item.caption || "电商多图提示词优化";

  summaryMain.append(title, metaLine);

  const statePill = document.createElement("span");
  statePill.className = "pill assist-state-pill";
  statePill.textContent = getAssistStateLabel(item.assistState);

  summary.append(summaryMain, statePill);
  details.append(summary);

  const content = document.createElement("div");
  content.className = "assist-content";

  if (item.assistState !== "complete") {
    const loading = document.createElement("div");
    loading.innerHTML = `
      <div class="loading-dots" aria-label="loading">
        <span></span><span></span><span></span>
      </div>
    `;
    if (item.assistState === "pending") {
      content.append(loading);
    }
  }

  content.append(renderMutedParagraph(getAssistStageText(item.assistStage, item.assistMeta)));

  const prompts = renderAssistPromptList(item.assistPrompts);
  if (prompts) {
    const sectionTitle = document.createElement("div");
    sectionTitle.className = "message-section-title";
    sectionTitle.textContent = "优化后的多图提示词";
    content.append(sectionTitle, prompts);
  }

  if (item.diagnostics) {
    const panel = renderDiagnosticPanel(item.diagnostics);
    if (panel) {
      content.append(panel);
    }
  }

  details.append(content);
  return details;
}

function getReverseStateLabel(stateValue) {
  if (stateValue === "complete") {
    return "已完成";
  }
  if (stateValue === "failed") {
    return "失败";
  }
  return "分析中";
}

function getReverseStageText(stageValue, meta) {
  const summary = meta
    ? formatReverseSummary(meta.assistantModel, meta.reasoningEffort)
    : "图片反推";

  if (stageValue === "complete") {
    return `${summary} 已输出可直接生图的提示词结果。`;
  }
  if (stageValue === "failed") {
    return `${summary} 反推失败，请检查上游兼容性或更换文本模型。`;
  }

  return `${summary} 正在读取图片内容、拆解画面要素并整理成提示词。`;
}

function buildReverseResultSummary(result) {
  const variantCount = Array.isArray(result?.variants) ? result.variants.length : 0;
  if (variantCount > 1) {
    return `图片反推已完成，生成了 ${variantCount} 个可用提示词版本。`;
  }

  if (getActivePrimaryPrompt(result)) {
    return "图片反推已完成，已生成可直接生图的主提示词。";
  }

  return "图片反推已完成。";
}

function buildReverseProgressMessage({
  reverseState = "pending",
  reverseStage = "requesting",
  reverseMeta = null,
  reverseResult = null,
  diagnostics = null,
  references = [],
  promptText = "",
  retryRequest = null,
}) {
  const normalizedMeta = normalizeReverseMeta(reverseMeta);
  const normalizedResult = normalizeReversePromptResult(reverseResult);
  const isCompleted = reverseState === "complete";
  const isFailed = reverseState === "failed";

  let text = "正在根据图片反推提示词。";
  if (isCompleted) {
    text = buildReverseResultSummary(normalizedResult);
  } else if (isFailed) {
    text = "图片反推失败。";
  }

  const captionParts = [];
  if (normalizedMeta) {
    captionParts.push(
      formatReverseSummary(normalizedMeta.assistantModel, normalizedMeta.reasoningEffort)
    );
    if (normalizedMeta.imageCount > 0) {
      captionParts.push(`${normalizedMeta.imageCount} 张图片`);
    }
  }
  if (promptText) {
    captionParts.push(`补充要求：${truncateText(promptText, 48)}`);
  }

  return {
    role: "assistant",
    type: "reverse",
    text,
    caption: captionParts.join(" / "),
    diagnostics,
    retryRequest: retryRequest ? { ...retryRequest } : null,
    reverseState,
    reverseStage,
    reverseMeta: normalizedMeta,
    reverseResult: normalizedResult,
    reverseExpanded: !isCompleted,
    assistState: null,
    assistStage: null,
    assistMeta: null,
    assistPlan: null,
    assistPrompts: [],
    assistExpanded: false,
    batchGroupId: null,
    batchGroupIndex: null,
    batchGroupTotal: null,
    batchKind: null,
    batchKindIndex: null,
    batchKindCount: null,
    requestSize: null,
    resultSize: null,
    legacySizeRecord: false,
    outputFormat: null,
    filename: null,
    assetId: null,
    assetUnavailable: false,
    previewUrl: null,
    downloadUrl: null,
    references: cloneReferenceList(references),
    time: nowLabel(),
  };
}

function persistReverseExpandedState(index, expanded) {
  if (!Number.isInteger(index) || index < 0 || index >= state.thread.length) {
    return;
  }

  state.thread[index] = {
    ...state.thread[index],
    reverseExpanded: Boolean(expanded),
  };
  void persistThread();
}

async function writeTextToClipboard(text) {
  const value = String(text || "").trim();
  if (!value) {
    return false;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const succeeded = document.execCommand("copy");
  textarea.remove();
  return succeeded;
}

function createAsyncStatusButton({
  label,
  pendingLabel,
  successLabel,
  failureLabel,
  className = "secondary-button",
  action,
}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", async () => {
    if (button.disabled) {
      return;
    }

    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = pendingLabel;

    try {
      const success = await action();
      button.textContent = success === false ? originalLabel : successLabel;
    } catch (error) {
      console.warn("Action failed.", error);
      button.textContent = failureLabel;
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = label;
      }, 1200);
    }
  });
  return button;
}

function primeComposerWithPrompt(prompt, options = {}) {
  const cleanPrompt = compactWhitespace(prompt);
  if (!cleanPrompt) {
    return;
  }

  const nextReferences = Array.isArray(options.references)
    ? cloneReferenceList(options.references)
    : [];

  if (options.clearReferences !== false) {
    clearComposerReferenceImages();
  }

  if (nextReferences.length) {
    state.referenceImages = nextReferences;
    renderComposerReferenceStrip();
  }

  setComposerMode("generate");
  if (dom.promptInput) {
    dom.promptInput.value = cleanPrompt;
    dom.promptInput.focus();
  }
  updateQuantityHint(cleanPrompt);
}

async function continueGenerateFromPrompt(prompt, options = {}) {
  const cleanPrompt = compactWhitespace(prompt);
  if (!cleanPrompt) {
    return false;
  }

  const references = Array.isArray(options.references)
    ? cloneReferenceList(options.references)
    : [];

  primeComposerWithPrompt(cleanPrompt, {
    clearReferences: references.length === 0,
    references,
  });
  return true;
}

function createCopyPromptButton(prompt, label = "复制", className = "secondary-button") {
  return createAsyncStatusButton({
    label,
    pendingLabel: "复制中...",
    successLabel: "已复制",
    failureLabel: "复制失败",
    className,
    action: () => writeTextToClipboard(prompt),
  });
}

function createFillPromptButton(prompt, label = "填入输入框", className = "secondary-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", () => {
    primeComposerWithPrompt(prompt, { clearReferences: true });
  });
  return button;
}

function createGeneratePromptButton(prompt, label = "继续生图", className = "primary-button") {
  return createAsyncStatusButton({
    label,
    pendingLabel: "发送中...",
    successLabel: "已开始",
    failureLabel: "发送失败",
    className,
    action: () => continueGenerateFromPrompt(prompt),
  });
}

function buildPromptActionBar(prompt, options = {}) {
  const cleanPrompt = compactWhitespace(prompt);
  if (!cleanPrompt) {
    return null;
  }

  const actions = document.createElement("div");
  actions.className = "reverse-actions";
  actions.append(
    createCopyPromptButton(cleanPrompt, options.copyLabel || "复制"),
    createFillPromptButton(cleanPrompt, options.fillLabel || "填入输入框"),
    createGeneratePromptButton(cleanPrompt, options.generateLabel || "继续生图")
  );
  return actions;
}

function createReversePromptCard(title, prompt, options = {}) {
  const cleanPrompt = compactWhitespace(prompt);
  if (!cleanPrompt) {
    return null;
  }

  const card = document.createElement("article");
  card.className = `reverse-prompt-card${options.primary ? " is-primary" : ""}`;

  const heading = document.createElement("div");
  heading.className = "assist-prompt-heading";
  heading.textContent = title;

  const textNode = document.createElement("p");
  textNode.className = "reverse-prompt-text";
  textNode.textContent = cleanPrompt;

  card.append(heading, textNode);

  const actions = buildPromptActionBar(cleanPrompt, options);
  if (actions) {
    card.append(actions);
  }

  return card;
}

function renderReverseBreakdown(breakdown) {
  const entries = Object.entries(breakdown || {}).filter(([, value]) => compactWhitespace(value));
  if (!entries.length) {
    return null;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "reverse-breakdown";

  entries.forEach(([key, value]) => {
    const item = document.createElement("article");
    item.className = "reverse-breakdown-item";

    const title = document.createElement("div");
    title.className = "assist-prompt-heading";
    title.textContent = key;

    const content = document.createElement("p");
    content.className = "assist-prompt-text";
    content.textContent = value;

    item.append(title, content);
    wrapper.append(item);
  });

  return wrapper;
}

function renderReverseTagList(title, values) {
  const items = Array.isArray(values) ? values.map((entry) => compactWhitespace(entry)).filter(Boolean) : [];
  if (!items.length) {
    return null;
  }

  const wrapper = document.createElement("section");
  wrapper.className = "reverse-chip-section";

  const heading = document.createElement("div");
  heading.className = "message-section-title";
  heading.textContent = title;

  const chips = document.createElement("div");
  chips.className = "reverse-chip-list";
  items.forEach((value) => {
    const chip = document.createElement("span");
    chip.className = "pill";
    chip.textContent = value;
    chips.append(chip);
  });

  wrapper.append(heading, chips);
  return wrapper;
}

function renderReversePointList(title, values) {
  const items = Array.isArray(values) ? values.map((entry) => compactWhitespace(entry)).filter(Boolean) : [];
  if (!items.length) {
    return null;
  }

  const wrapper = document.createElement("section");
  wrapper.className = "reverse-point-section";

  const heading = document.createElement("div");
  heading.className = "message-section-title";
  heading.textContent = title;

  const list = document.createElement("ul");
  list.className = "reverse-point-list";
  items.forEach((value) => {
    const li = document.createElement("li");
    li.textContent = value;
    list.append(li);
  });

  wrapper.append(heading, list);
  return wrapper;
}

function renderReverseVariants(result) {
  const variants = Array.isArray(result?.variants) ? result.variants : [];
  if (!variants.length) {
    return null;
  }

  const wrapper = document.createElement("section");
  wrapper.className = "assist-prompt-list";

  variants.forEach((variant, index) => {
    const card = createReversePromptCard(
      compactWhitespace(variant.title) || `变体 ${index + 1}`,
      variant.prompt,
      {
        copyLabel: "复制变体",
        fillLabel: "使用此变体",
        generateLabel: "直接生图",
      }
    );
    if (card) {
      wrapper.append(card);
    }
  });

  return wrapper;
}

async function createReferenceFromImageItem(item, index = 0) {
  const blob = await resolveDownloadBlob(item);
  if (!(blob instanceof Blob) || blob.size <= 0) {
    throw new Error("当前图片没有可用的缓存数据。");
  }

  const extension =
    blob.type === "image/jpeg"
      ? "jpg"
      : blob.type === "image/webp"
        ? "webp"
        : item?.outputFormat === "jpeg"
          ? "jpg"
          : item?.outputFormat === "webp"
            ? "webp"
            : "png";

  return {
    id: createAssetId(),
    assetId: item?.assetId || null,
    name:
      item?.filename ||
      `reverse-source-${Date.now()}-${index + 1}.${extension}`,
    type: blob.type || getMimeTypeForFormat(item?.outputFormat),
    size: Number(blob.size) || 0,
    dataUrl: null,
    previewUrl: URL.createObjectURL(blob),
    blob,
    assetUnavailable: false,
  };
}

async function useImageAsReverseReference(item) {
  if (state.isGenerating || state.generationSession?.paused) {
    return false;
  }

  try {
    const reference = await createReferenceFromImageItem(item);
    clearComposerReferenceImages();
    state.referenceImages = [reference];
    renderComposerReferenceStrip();
    setComposerMode("reverse", { focus: true });
    return true;
  } catch (error) {
    console.warn("Failed to reuse image as reverse reference.", error);
    setReferenceTip("载入图片失败，请稍后再试。", "warning");
    return false;
  }
}

function createReverseButton(item, className = "secondary-button") {
  return createAsyncStatusButton({
    label: "反推",
    pendingLabel: "载入中...",
    successLabel: "已载入",
    failureLabel: "载入失败",
    className,
    action: () => useImageAsReverseReference(item),
  });
}

async function retryReverseMessage(index) {
  const item = state.thread[index];
  if (!item || item.type !== "reverse" || state.isGenerating || state.generationSession?.paused) {
    return false;
  }

  const retryPrompt = item.retryRequest?.prompt || "";
  const retryReferences = cloneReferenceList(item.retryRequest?.references || item.references);
  if (!retryReferences.length) {
    return false;
  }

  await reversePromptFromImages(retryPrompt, retryReferences, true, {
    replaceIndex: index,
  });
  return true;
}

function renderReverseMessage(item, itemIndex) {
  const details = document.createElement("details");
  details.className = `assist-details reverse-details is-${item.reverseState || "pending"}`;
  details.open = item.reverseExpanded !== false;
  details.addEventListener("toggle", () => {
    persistReverseExpandedState(itemIndex, details.open);
  });

  const summary = document.createElement("summary");
  summary.className = "assist-summary";

  const summaryMain = document.createElement("div");
  summaryMain.className = "assist-summary-main";

  const title = document.createElement("span");
  title.className = "assist-summary-title";
  title.textContent = item.text || "图片反推提示词";

  const metaLine = document.createElement("span");
  metaLine.className = "assist-summary-meta";
  metaLine.textContent = item.caption || "图片反推";

  summaryMain.append(title, metaLine);

  const statePill = document.createElement("span");
  statePill.className = "pill assist-state-pill";
  statePill.textContent = getReverseStateLabel(item.reverseState);

  summary.append(summaryMain, statePill);
  details.append(summary);

  const content = document.createElement("div");
  content.className = "assist-content reverse-content";

  if (item.reverseState !== "complete") {
    const loading = document.createElement("div");
    loading.innerHTML = `
      <div class="loading-dots" aria-label="loading">
        <span></span><span></span><span></span>
      </div>
    `;
    if (item.reverseState === "pending") {
      content.append(loading);
    }
  }

  content.append(renderMutedParagraph(getReverseStageText(item.reverseStage, item.reverseMeta)));

  if (item.references?.length) {
    const referenceSection = renderReferenceSection(item.references, "分析图片");
    if (referenceSection) {
      content.append(referenceSection);
    }
  }

  if (item.reverseResult?.summary) {
    content.append(renderParagraph(item.reverseResult.summary));
  }

  const primaryCnCard = createReversePromptCard("中文主提示词", item.reverseResult?.promptCn, {
    primary: true,
  });
  if (primaryCnCard) {
    content.append(primaryCnCard);
  }

  const primaryEnCard = createReversePromptCard("英文主提示词", item.reverseResult?.promptEn);
  if (primaryEnCard) {
    content.append(primaryEnCard);
  }

  const negativePromptCard = createReversePromptCard(
    "负向提示词",
    item.reverseResult?.negativePrompt,
    {
      copyLabel: "复制负向词",
      fillLabel: "填入输入框",
      generateLabel: "继续生图",
    }
  );
  if (negativePromptCard) {
    content.append(negativePromptCard);
  }

  const styleTags = renderReverseTagList("风格标签", item.reverseResult?.styleTags);
  if (styleTags) {
    content.append(styleTags);
  }

  const breakdown = renderReverseBreakdown(item.reverseResult?.visualBreakdown);
  if (breakdown) {
    const section = document.createElement("section");
    section.className = "reverse-breakdown-section";
    const heading = document.createElement("div");
    heading.className = "message-section-title";
    heading.textContent = "画面拆解";
    section.append(heading, breakdown);
    content.append(section);
  }

  const variants = renderReverseVariants(item.reverseResult);
  if (variants) {
    const section = document.createElement("section");
    section.className = "reverse-variant-section";
    const heading = document.createElement("div");
    heading.className = "message-section-title";
    heading.textContent = "可选变体";
    section.append(heading, variants);
    content.append(section);
  }

  const uncertainPoints = renderReversePointList(
    "不确定项",
    item.reverseResult?.uncertainPoints
  );
  if (uncertainPoints) {
    content.append(uncertainPoints);
  }

  if (item.reverseState === "failed") {
    const retryActions = document.createElement("div");
    retryActions.className = "reverse-actions";
    retryActions.append(
      createAsyncStatusButton({
        label: "重试反推",
        pendingLabel: "重试中...",
        successLabel: "已开始",
        failureLabel: "重试失败",
        className: "secondary-button",
        action: () => retryReverseMessage(itemIndex),
      })
    );
    content.append(retryActions);
  }

  if (item.diagnostics) {
    const panel = renderDiagnosticPanel(item.diagnostics);
    if (panel) {
      content.append(panel);
    }
  }

  details.append(content);
  return details;
}

function createImageElement(item, compact = false) {
  if (!item?.previewUrl) {
    return null;
  }

  const image = document.createElement("img");
  image.src = item.previewUrl;
  image.alt = item.text || "generated image";
  image.loading = "lazy";
  image.className = `zoomable-image${compact ? " is-compact" : ""}`;
  image.tabIndex = 0;
  image.setAttribute("role", "button");
  image.setAttribute("aria-label", "点击放大查看图片");
  image.addEventListener("click", () => {
    openImagePreview(item.downloadUrl || item.previewUrl, image.alt);
  });
  image.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openImagePreview(item.downloadUrl || item.previewUrl, image.alt);
    }
  });
  return image;
}

function createDownloadButton(item, className = "primary-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = "下载";
  button.addEventListener("click", async () => {
    if (button.disabled) {
      return;
    }

    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "准备中...";

    try {
      const started = await triggerDownload(item);
      button.textContent = started ? "已开始" : originalLabel;
    } catch (error) {
      console.warn("Failed to download image.", error);
      button.textContent = "下载失败";
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = originalLabel;
      }, 1200);
    }
  });
  return button;
}

function canDownloadImageItem(item) {
  return Boolean(item?.assetId || item?.downloadUrl || item?.previewUrl);
}

function splitFilenameParts(filename) {
  const value = String(filename || "").trim();
  const lastDotIndex = value.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex === value.length - 1) {
    return { base: value || "gpt-image", extension: "" };
  }

  return {
    base: value.slice(0, lastDotIndex),
    extension: value.slice(lastDotIndex),
  };
}

function sanitizeDownloadFilename(filename, fallbackIndex = 1) {
  const normalized = String(filename || "").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "-");
  if (normalized) {
    return normalized;
  }

  return `gpt-image-${fallbackIndex}.png`;
}

function buildUniqueDownloadFilenames(filenames) {
  const used = new Set();

  return (Array.isArray(filenames) ? filenames : []).map((filename, index) => {
    const safeName = sanitizeDownloadFilename(filename, index + 1);
    const { base, extension } = splitFilenameParts(safeName);
    let candidate = safeName;
    let suffix = 2;

    while (used.has(candidate.toLowerCase())) {
      candidate = `${base}-${suffix}${extension}`;
      suffix += 1;
    }

    used.add(candidate.toLowerCase());
    return candidate;
  });
}

function triggerBlobDownload(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1500);
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function triggerBatchDownload(items) {
  const candidates = Array.isArray(items) ? items.filter(canDownloadImageItem) : [];
  if (!candidates.length) {
    throw new Error("No downloadable image data available.");
  }

  let directoryHandle = null;
  if (typeof window.showDirectoryPicker === "function" && window.isSecureContext) {
    try {
      directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (error) {
      if (error?.name === "AbortError") {
        return {
          cancelled: true,
          totalCount: candidates.length,
          startedCount: 0,
          failedCount: 0,
        };
      }

      console.warn("showDirectoryPicker failed, falling back to anchor download.", error);
    }
  }

  const preparedItems = [];
  let failedCount = 0;

  for (const [index, item] of candidates.entries()) {
    try {
      const blob = await resolveDownloadBlob(item);
      if (!(blob instanceof Blob) || blob.size <= 0) {
        throw new Error("No downloadable image data available.");
      }

      preparedItems.push({
        blob,
        filename: buildDownloadFilename(item),
        fallbackIndex: index + 1,
      });
    } catch (error) {
      failedCount += 1;
      console.warn("Failed to prepare batch download image.", error);
    }
  }

  if (!preparedItems.length) {
    throw new Error("No downloadable image data available.");
  }

  const uniqueFilenames = buildUniqueDownloadFilenames(
    preparedItems.map((entry) => sanitizeDownloadFilename(entry.filename, entry.fallbackIndex))
  );

  let startedCount = 0;

  if (directoryHandle) {
    for (const [index, entry] of preparedItems.entries()) {
      try {
        const fileHandle = await directoryHandle.getFileHandle(uniqueFilenames[index], {
          create: true,
        });
        const writable = await fileHandle.createWritable();
        await writable.write(entry.blob);
        await writable.close();
        startedCount += 1;
      } catch (error) {
        failedCount += 1;
        console.warn("Failed to write batch download image.", error);
      }
    }

    return {
      cancelled: false,
      totalCount: candidates.length,
      startedCount,
      failedCount,
    };
  }

  for (const [index, entry] of preparedItems.entries()) {
    try {
      triggerBlobDownload(entry.blob, uniqueFilenames[index]);
      startedCount += 1;
      await wait(120);
    } catch (error) {
      failedCount += 1;
      console.warn("Failed to trigger batch anchor download.", error);
    }
  }

  return {
    cancelled: false,
    totalCount: candidates.length,
    startedCount,
    failedCount,
  };
}

function createBatchDownloadButton(items, className = "secondary-button") {
  const downloadableCount = Array.isArray(items) ? items.filter(canDownloadImageItem).length : 0;
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = downloadableCount ? `批量下载 ${downloadableCount} 张` : "暂无可下载图片";
  button.disabled = downloadableCount <= 0;
  button.addEventListener("click", async () => {
    if (button.disabled) {
      return;
    }

    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "批量准备中...";

    try {
      const result = await triggerBatchDownload(items);
      if (result?.cancelled) {
        button.disabled = false;
        button.textContent = originalLabel;
        return;
      }

      if (result?.startedCount > 0) {
        button.textContent =
          result.failedCount > 0
            ? `已开始 ${result.startedCount}/${result.totalCount}`
            : "已开始";
      } else {
        button.textContent = "下载失败";
      }
    } catch (error) {
      console.warn("Failed to batch download images.", error);
      button.textContent = "下载失败";
    } finally {
      if (button.textContent !== originalLabel) {
        window.setTimeout(() => {
          button.disabled = downloadableCount <= 0;
          button.textContent = originalLabel;
        }, 1500);
      }
    }
  });
  return button;
}

function createImageMetaNode(item, compact = false) {
  const meta = document.createElement("div");
  meta.className = `image-meta${compact ? " is-compact" : ""}`;
  const requestLabel = item.legacySizeRecord ? "旧请求" : "请求";
  const resultLabel = item.legacySizeRecord ? "旧结果" : "返回";
  meta.innerHTML = `
    <span class="pill">${escapeHtml(`${requestLabel} ${item.requestSize || "-"}`)}</span>
    <span class="pill">${escapeHtml(`${resultLabel} ${item.resultSize || "-"}`)}</span>
    <span class="pill">${escapeHtml(item.outputFormat?.toUpperCase() || "PNG")}</span>
  `;
  return meta;
}

function buildCompactImageLabel(item, fallbackIndex = 1) {
  const index = Number(item?.batchGroupIndex) || Number(item?.globalIndex) || fallbackIndex;
  const batchLabel = formatBatchItemLabel({
    kind: item?.batchKind || item?.kind,
    kindIndex: item?.batchKindIndex || item?.kindIndex,
    kindCount: item?.batchKindCount || item?.kindCount,
    globalIndex: item?.batchGroupIndex || item?.globalIndex || index,
    total: item?.batchGroupTotal || item?.total || 1,
  });
  if (batchLabel) {
    return batchLabel;
  }

  if (item?.batchGroupTotal > 1) {
    return `第 ${index}/${item.batchGroupTotal} 张`;
  }

  return truncateText(item?.text || `第 ${index} 张`, 30);
}

function renderSingleImageCard(item) {
  const imageCard = document.createElement("section");
  imageCard.className = "image-card";

  const image = createImageElement(item, false);
  if (image) {
    imageCard.append(image);
  }

  const toolbar = document.createElement("div");
  toolbar.className = "image-toolbar";
  toolbar.append(
    createImageMetaNode(item),
    createReverseButton(item),
    createDownloadButton(item)
  );
  imageCard.append(toolbar);

  return imageCard;
}

function renderBatchImageCard(item, index) {
  const card = document.createElement("article");
  card.className = "image-card image-card-compact";

  const label = document.createElement("div");
  label.className = "image-card-label";
  label.textContent = buildCompactImageLabel(item, index + 1);
  card.title = [label.textContent, item.caption || ""].filter(Boolean).join("\n");
  card.append(label);

  const image = createImageElement(item, true);
  if (image) {
    card.append(image);
  } else {
    card.append(renderMutedParagraph(item.assetUnavailable ? "图片缓存已丢失。" : "图片预览不可用。"));
  }

  const toolbar = document.createElement("div");
  toolbar.className = "image-toolbar is-compact";
  toolbar.append(
    createImageMetaNode(item, true),
    createReverseButton(item, "secondary-button"),
    createDownloadButton(item, "secondary-button")
  );
  card.append(toolbar);
  return card;
}

function collectImageBatchGroup(items, startIndex) {
  const first = items[startIndex];
  if (
    !first ||
    first.type !== "image" ||
    !first.batchGroupId ||
    normalizeBatchGroupCount(first.batchGroupTotal, 1) <= 1
  ) {
    return null;
  }

  const groupedItems = [];
  let nextIndex = startIndex;

  while (nextIndex < items.length) {
    const candidate = items[nextIndex];
    if (candidate?.type !== "image" || candidate.batchGroupId !== first.batchGroupId) {
      break;
    }
    groupedItems.push(candidate);
    nextIndex += 1;
  }

  if (groupedItems.length <= 1) {
    return null;
  }

  return {
    items: groupedItems,
    nextIndex,
    total: normalizeBatchGroupCount(first.batchGroupTotal, groupedItems.length),
  };
}

function renderImageBatchGroup(group) {
  const wrapper = document.createElement("section");
  wrapper.className = "image-batch";

  const head = document.createElement("div");
  head.className = "image-batch-head";

  const copy = document.createElement("div");
  copy.className = "image-batch-copy";

  const title = document.createElement("div");
  title.className = "message-section-title";
  title.textContent = `多图结果 ${group.items.length}/${group.total}`;

  const caption = document.createElement("p");
  caption.className = "message-caption";
  caption.textContent = "缩略图已并排显示，点击任意图片可放大查看。";

  copy.append(title, caption);
  head.append(copy, createBatchDownloadButton(group.items));

  const grid = document.createElement("div");
  grid.className = "image-batch-grid";
  group.items.forEach((item, index) => {
    grid.append(renderBatchImageCard(item, index));
  });

  wrapper.append(head, grid);
  return wrapper;
}

function renderDiagnosticPanel(diagnostics) {
  const entries = Object.entries(diagnostics || {}).filter(([, value]) => {
    return value !== null && value !== undefined && String(value).trim() !== "";
  });

  if (!entries.length) {
    return null;
  }

  const labels = {
    kind: "错误类型",
    endpoint: "请求端点",
    mode: "请求模式",
    status: "HTTP 状态码",
    statusText: "状态文本",
    model: "模型",
    size: "尺寸",
    referenceCount: "参考图数量",
    upstreamSummary: "上游摘要",
    assistantModel: "辅助模型",
    reasoningEffort: "推理强度",
    errorName: "异常名称",
    errorMessage: "异常消息",
    causeCode: "底层错误码",
    causeMessage: "底层错误",
  };

  const panel = document.createElement("div");
  panel.className = "diagnostic-panel";

  for (const [key, value] of entries) {
    const row = document.createElement("div");
    row.className = "diagnostic-row";

    const label = document.createElement("span");
    label.className = "diagnostic-label";
    label.textContent = labels[key] || key;

    const content = document.createElement("code");
    content.className = "diagnostic-value";
    content.textContent = String(value);

    row.append(label, content);
    panel.append(row);
  }

  return panel;
}

function renderReferenceGrid(referenceList, options = {}) {
  const references = Array.isArray(referenceList) ? referenceList : [];
  if (!references.length) {
    return null;
  }

  const grid = document.createElement("div");
  grid.className = `reference-grid${options.compact ? " is-compact" : ""}`;

  references.forEach((reference, index) => {
    const card = document.createElement("div");
    card.className = "reference-card";

    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className = "reference-preview";

    if (reference.previewUrl) {
      const image = document.createElement("img");
      image.src = reference.previewUrl;
      image.alt = reference.name || `参考图 ${index + 1}`;
      image.loading = "lazy";
      previewButton.append(image);

      previewButton.addEventListener("click", () => {
        openImagePreview(reference.previewUrl, image.alt);
      });
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "reference-placeholder";
      placeholder.textContent = reference.assetUnavailable ? "缓存丢失" : "参考图";
      previewButton.append(placeholder);
      previewButton.disabled = true;
    }

    const meta = document.createElement("div");
    meta.className = "reference-meta";
    meta.innerHTML = `
      <strong>${escapeHtml(truncateText(reference.name || `参考图 ${index + 1}`, 18))}</strong>
      <span>${escapeHtml(formatBytes(reference.size || 0))}</span>
    `;

    card.append(previewButton, meta);

    if (typeof options.onRemove === "function") {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "reference-remove";
      removeButton.textContent = "移除";
      removeButton.addEventListener("click", () => {
        options.onRemove(reference.id);
      });
      card.append(removeButton);
    }

    grid.append(card);
  });

  return grid;
}

function renderReferenceSection(referenceList, title) {
  const grid = renderReferenceGrid(referenceList, { compact: true });
  if (!grid) {
    return null;
  }

  const wrapper = document.createElement("section");
  wrapper.className = "message-reference-section";

  if (title) {
    const heading = document.createElement("div");
    heading.className = "message-section-title";
    heading.textContent = title;
    wrapper.append(heading);
  }

  wrapper.append(grid);
  return wrapper;
}

function renderComposerReferenceStrip() {
  if (!dom.composerReferenceStrip) {
    return;
  }

  dom.composerReferenceStrip.innerHTML = "";
  const grid = renderReferenceGrid(state.referenceImages, {
    onRemove: (referenceId) => {
      removeComposerReference(referenceId);
    },
  });

  if (grid) {
    dom.composerReferenceStrip.append(grid);
  }

  updateReferenceUi();
}

function parseLegacyControlsFromCaption(caption) {
  const text = String(caption || "").toUpperCase();

  return {
    aspect: text.includes("9:16")
      ? "nineSixteen"
      : text.includes("4:3")
        ? "fourThree"
      : text.includes("3:4")
        ? "threeFour"
        : text.includes("16:9") || text.includes("LANDSCAPE") || text.includes("横图")
          ? "landscape"
          : text.includes("PORTRAIT") || text.includes("竖图")
            ? "nineSixteen"
            : "square",
    resolution: text.includes("4K") ? "4k" : text.includes("2K") ? "2k" : "1k",
    outputFormat: text.includes("WEBP") ? "webp" : text.includes("JPEG") ? "jpeg" : "png",
    quality: dom.qualitySelect.value,
    background: dom.backgroundSelect.value,
  };
}

function buildLegacyRetryRequest(index) {
  const item = state.thread[index];
  if (!item || item.retryRequest || item.role !== "system" || item.type !== "text") {
    return null;
  }

  for (let i = index - 1; i >= 0; i -= 1) {
    const previous = state.thread[i];
    if (previous?.role === "user" && previous?.text) {
      return {
        prompt: previous.text,
        controls: parseLegacyControlsFromCaption(previous.caption),
        references: cloneReferenceList(previous.references),
      };
    }
  }

  return null;
}

function buildFailureCaption(diagnostics) {
  if (!diagnostics) {
    return "请检查设置中的 API 端点、密钥和模型名后再试。";
  }

  if (diagnostics.kind === "upstream_fetch_failed") {
    return "本地代理连上游接口都没连通，常见原因是端点错误、DNS/TLS 问题或第三方网关故障。";
  }

  if (diagnostics.kind === "upstream_http_error") {
    return "上游接口已返回失败状态。先看下面的状态码、端点和上游摘要，再决定重试还是改模型。";
  }

  if (diagnostics.kind === "missing_image_data") {
    return "上游返回了成功响应，但响应体里没有可用的图片数据。";
  }

  if (diagnostics.kind === "local_request_failed") {
    return "浏览器到本地代理的请求失败了，先确认本地服务是否仍在运行。";
  }

  if (diagnostics.kind === "missing_reference_assets") {
    return "这次重试需要的参考图缓存已经丢失，请重新粘贴参考图后再发起请求。";
  }

  if (diagnostics.kind === "assistant_prompt_failed") {
    return "辅助文本模型调用失败，系统已回退到原始多图提示词。";
  }

  return "请检查设置中的 API 端点、密钥和模型名后再试。";
}

function buildLoadingMessagePatch(text) {
  return {
    role: "assistant",
    type: "loading",
    text,
    caption: "",
    diagnostics: null,
    retryRequest: null,
    assistState: null,
    assistStage: null,
    assistMeta: null,
    assistPlan: null,
    assistPrompts: [],
    assistExpanded: false,
    reverseState: null,
    reverseStage: null,
    reverseMeta: null,
    reverseResult: null,
    reverseExpanded: false,
    batchGroupId: null,
    batchGroupIndex: null,
    batchGroupTotal: null,
    requestSize: null,
    resultSize: null,
    legacySizeRecord: false,
    outputFormat: null,
    filename: null,
    assetId: null,
    assetUnavailable: false,
    previewUrl: null,
    downloadUrl: null,
    time: nowLabel(),
  };
}

function sanitizeRetryExecutionOptions(executionOptions) {
  if (!executionOptions || typeof executionOptions !== "object") {
    return null;
  }

  const next = { ...executionOptions };
  if (next.batchItem && typeof next.batchItem === "object") {
    next.batchItem = { ...next.batchItem };
  }
  if (Array.isArray(next.queue)) {
    next.queue = next.queue.map((item) => ({ ...item }));
  }
  if (next.assistantMeta && typeof next.assistantMeta === "object") {
    next.assistantMeta = { ...next.assistantMeta };
  }
  delete next.replaceIndex;
  return Object.keys(next).length ? next : null;
}

function createGenerationSession({
  prompt,
  controls,
  settings,
  persistedReferences,
  requestReferences,
  queue,
  mode = "queue",
  isRetry = false,
  replaceIndex = null,
}) {
  return {
    prompt,
    controls: { ...controls },
    settings: { ...settings },
    persistedReferences: cloneReferenceList(persistedReferences),
    requestReferences: Array.isArray(requestReferences)
      ? requestReferences.map((reference) => ({ ...reference }))
      : [],
    queue: Array.isArray(queue) ? queue.map((item) => ({ ...item })) : [],
    mode: normalizeGenerationMode(mode),
    nextIndex: 0,
    isRetry: Boolean(isRetry),
    replaceIndex: Number.isInteger(replaceIndex) && replaceIndex >= 0 ? replaceIndex : null,
    paused: false,
    pauseRequested: false,
    stoppedByPause: false,
    failed: false,
  };
}

function hasActiveBatchSession() {
  return Boolean(
    state.generationSession &&
      state.generationSession.mode === "queue" &&
      state.generationSession.queue.length > 1
  );
}

function updateGenerationControls() {
  const session = state.generationSession;
  const hasBatch = hasActiveBatchSession();
  const running = state.isGenerating && hasBatch;
  const paused = Boolean(session?.paused && hasBatch);
  const canPause = running && !session.pauseRequested;
  const canResume = paused && !state.isGenerating && session.nextIndex < session.queue.length;

  if (dom.pauseGenerationButton) {
    dom.pauseGenerationButton.hidden = !hasBatch;
    dom.pauseGenerationButton.disabled = !canPause;
    dom.pauseGenerationButton.textContent =
      running && session.pauseRequested ? "暂停中..." : "暂停";
  }

  if (dom.resumeGenerationButton) {
    dom.resumeGenerationButton.hidden = !hasBatch;
    dom.resumeGenerationButton.disabled = !canResume;
    dom.resumeGenerationButton.textContent = "恢复";
  }

  if (dom.generateButton) {
    if (paused) {
      dom.generateButton.disabled = true;
      dom.generateButton.textContent = "已暂停";
    } else if (state.isGenerating) {
      dom.generateButton.disabled = true;
      dom.generateButton.textContent = state.activeRequestKind === "reverse" ? "反推中..." : "生成中...";
    } else {
      dom.generateButton.disabled = false;
      dom.generateButton.textContent =
        normalizeComposerMode(state.composerMode) === "reverse" ? "反推提示词" : "生成图片";
    }
  }

  if (dom.clearThreadButton) {
    dom.clearThreadButton.disabled = Boolean(state.isGenerating || paused);
  }
}

function requestPauseBatchGeneration() {
  if (!hasActiveBatchSession() || !state.isGenerating) {
    return;
  }

  state.generationSession.pauseRequested = true;
  updateGenerationControls();
}

async function resumeBatchGeneration() {
  const session = state.generationSession;
  if (!session || !session.paused || state.isGenerating || session.nextIndex >= session.queue.length) {
    return;
  }

  session.paused = false;
  session.pauseRequested = false;
  session.stoppedByPause = false;
  session.failed = false;
  await runGenerationSession(session);
}

async function runGenerationSession(session) {
  if (!session) {
    return;
  }

  state.generationSession = session;
  state.isGenerating = true;
  updateGenerationControls();

  try {
    while (session.nextIndex < session.queue.length) {
      const index = session.nextIndex;
      const batchItem = session.queue[index];
      const success = await generateSingleImageRequest({
        prompt: session.prompt,
        settings: session.settings,
        controls: session.controls,
        persistedReferences: session.persistedReferences,
        requestReferences: session.requestReferences,
        batchItem,
        isRetry: session.isRetry && index === 0,
        replaceIndex: index === 0 ? session.replaceIndex : null,
      });

      if (!success) {
        session.failed = true;
        break;
      }

      session.nextIndex += 1;

      if (session.pauseRequested && session.nextIndex < session.queue.length) {
        session.paused = true;
        session.stoppedByPause = true;
        session.pauseRequested = false;
        dom.latencyValue.textContent = `已暂停，待继续 ${session.queue.length - session.nextIndex} 张`;
        break;
      }
    }
  } finally {
    state.isGenerating = false;

    if (!session.paused && (session.failed || session.nextIndex >= session.queue.length)) {
      state.generationSession = null;
    }

    renderThread();
    updateStatus();
  }
}

async function runParallelGenerationSession(session) {
  if (!session) {
    return;
  }

  state.generationSession = session;
  state.isGenerating = true;
  updateGenerationControls();

  const replaceIndex =
    Number.isInteger(session.replaceIndex) && session.replaceIndex >= 0 ? session.replaceIndex : null;
  const placeholderIndexes = [];

  try {
    for (let index = 0; index < session.queue.length; index += 1) {
      const batchItem = session.queue[index];
      if (index === 0 && session.isRetry && replaceIndex !== null) {
        placeholderIndexes.push(replaceIndex);
        continue;
      }

      await addMessage({
        role: "assistant",
        type: "loading",
        text: buildLoadingText(false, batchItem),
        time: nowLabel(),
      });
      placeholderIndexes.push(state.thread.length - 1);
    }

    const results = await Promise.all(
      session.queue.map((batchItem, index) =>
        generateSingleImageRequest({
          prompt: session.prompt,
          settings: session.settings,
          controls: session.controls,
          persistedReferences: session.persistedReferences,
          requestReferences: session.requestReferences,
          batchItem,
          isRetry: session.isRetry && index === 0,
          replaceIndex: placeholderIndexes[index] ?? null,
        })
      )
    );

    session.nextIndex = session.queue.length;
    session.failed = results.some((success) => !success);
  } finally {
    state.isGenerating = false;
    state.generationSession = null;
    renderThread();
    updateStatus();
  }
}

function buildRequestPrompt(prompt, references) {
  const cleanPrompt = String(prompt || "").trim();
  const cleanReferences = Array.isArray(references) ? references : [];

  if (!cleanReferences.length) {
    return cleanPrompt;
  }

  const blocks = [];

  blocks.push("Current image request:");
  blocks.push(cleanPrompt);

  if (cleanReferences.length) {
    blocks.push("");
    blocks.push(
      `Reference images attached: ${cleanReferences.length}. Use them as visual guidance and preserve relevant subject, composition, material, color, lighting, or style cues unless the user explicitly asks to change them.`
    );
  }

  return blocks.join("\n").trim();
}

function renderThread() {
  dom.thread.innerHTML = "";

  if (!state.thread.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <p>这里会按对话线程保存你的提示词、参考图、参数和生成结果。</p>
      <p>生成图片优先缓存到当前浏览器，刷新后仍可继续预览，但不会自动写入本地文件。</p>
    `;
    dom.thread.append(empty);
    updateStatus();
    return;
  }

  for (let itemIndex = 0; itemIndex < state.thread.length; itemIndex += 1) {
    const item = state.thread[itemIndex];
    const groupedImages = collectImageBatchGroup(state.thread, itemIndex);
    const fragment = dom.messageTemplate.content.cloneNode(true);
    const article = fragment.querySelector(".message");
    const role = fragment.querySelector(".role");
    const time = fragment.querySelector(".time");
    const body = fragment.querySelector(".message-body");

    article.dataset.role = item.role;
    role.textContent = item.role;
    time.textContent = item.time || nowLabel();

    if (item.references?.length) {
      const referenceSection = renderReferenceSection(
        item.references,
        item.role === "user" ? "本次参考图" : "参考图"
      );
      if (referenceSection) {
        body.append(referenceSection);
      }
    }

    if (groupedImages) {
      article.classList.add("has-image-batch");
      body.append(renderImageBatchGroup(groupedImages));
      itemIndex = groupedImages.nextIndex - 1;
    } else if (item.type === "image") {
      body.append(renderParagraph(item.text || "图片生成完成。"));

      if (item.previewUrl) {
        body.append(renderSingleImageCard(item));
      } else if (item.assetUnavailable) {
        body.append(renderMutedParagraph("图片缓存已丢失，当前只保留文字记录。"));
      } else if (item.assetId) {
        body.append(renderMutedParagraph("图片正在从浏览器缓存恢复。"));
      } else {
        body.append(renderMutedParagraph("当前图片未写入浏览器缓存，刷新后只会保留文字记录。"));
      }

      if (item.caption) {
        body.append(renderMutedParagraph(item.caption));
      }

      if (item.legacySizeRecord) {
        body.append(
          renderMutedParagraph("这条图片记录来自旧版本，尺寸标签不代表当前版本发送给模型的真实请求尺寸。")
        );
      }
    } else if (item.type === "loading") {
      const loading = document.createElement("div");
      loading.innerHTML = `
        <div class="loading-dots" aria-label="loading">
          <span></span><span></span><span></span>
        </div>
      `;
      body.append(loading);

      if (item.text) {
        body.append(renderMutedParagraph(item.text));
      }
    } else if (item.type === "assist") {
      body.append(renderAssistMessage(item, itemIndex));
    } else if (item.type === "reverse") {
      body.append(renderReverseMessage(item, itemIndex));
    } else {
      body.append(renderParagraph(item.text || ""));

      if (item.caption) {
        body.append(renderMutedParagraph(item.caption));
      }

      if (item.diagnostics) {
        const panel = renderDiagnosticPanel(item.diagnostics);
        if (panel) {
          body.append(panel);
        }
      }

      const retryRequest = item.retryRequest || buildLegacyRetryRequest(itemIndex);
      if (retryRequest) {
        const actions = document.createElement("div");
        actions.className = "image-toolbar";

        const retryButton = document.createElement("button");
        retryButton.type = "button";
        retryButton.className = "secondary-button";
        const retryBlocked = Boolean(state.isGenerating || state.generationSession?.paused);
        retryButton.textContent = state.isGenerating
          ? "生成中..."
          : state.generationSession?.paused
            ? "批次已暂停"
            : "重试";
        retryButton.disabled = retryBlocked;
        retryButton.addEventListener("click", async () => {
          if (state.isGenerating || state.generationSession?.paused) {
            return;
          }

          await generateImage(
            retryRequest.prompt,
            retryRequest.controls,
            true,
            retryRequest.references,
            {
              ...(retryRequest.executionOptions || {}),
              replaceIndex: itemIndex,
            }
          );
        });

        actions.append(retryButton);
        body.append(actions);
      }
    }

    dom.thread.append(fragment);
  }

  dom.thread.scrollTop = dom.thread.scrollHeight;
  updateStatus();
}

function syncSettingsForm() {
  dom.endpointInput.value = state.settings.endpoint;
  dom.apiKeyInput.value = state.settings.apiKey;
  dom.modelInput.value = state.settings.model;
  dom.assistantModelInput.value = state.settings.assistantModel || DEFAULT_SETTINGS.assistantModel;
  dom.assistantSystemPromptInput.value = normalizeAssistantSystemPrompt(
    state.settings.assistantSystemPrompt
  );
  if (dom.reversePromptSystemPromptInput) {
    dom.reversePromptSystemPromptInput.value = normalizeReversePromptSystemPrompt(
      state.settings.reversePromptSystemPrompt
    );
  }
  dom.assistantReasoningEffortSelect.value = normalizeAssistantReasoningEffort(
    state.settings.assistantReasoningEffort
  );
  dom.moderationSelect.value = state.settings.moderation;
}

function readControls() {
  return {
    quality: dom.qualitySelect.value,
    background: dom.backgroundSelect.value,
    outputFormat: dom.outputFormatSelect.value,
    resolution: state.resolution,
    aspect: state.aspect,
    quantity: state.quantity,
    generationMode: normalizeGenerationMode(state.generationMode),
    ecommerceModeEnabled: Boolean(state.ecommerceModeEnabled),
  };
}

function buildDownloadFilename(message) {
  const raw = String(message?.filename || "").trim();
  if (raw) {
    return raw;
  }

  const extension =
    message?.outputFormat === "jpeg" ? "jpg" : message?.outputFormat === "webp" ? "webp" : "png";

  return `gpt-image.${extension}`;
}

async function resolveDownloadBlob(message) {
  if (message?.assetId) {
    const cachedBlob = await getBinaryAsset(message.assetId);
    if (cachedBlob instanceof Blob) {
      return cachedBlob;
    }
  }

  const sourceUrl = message?.downloadUrl || message?.previewUrl;
  if (!sourceUrl) {
    return null;
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Download source returned ${response.status}.`);
  }

  return response.blob();
}

function buildDownloadPickerOptions(blob, filename) {
  const extension = filename.includes(".") ? `.${filename.split(".").pop().toLowerCase()}` : ".png";
  const mimeType = blob?.type || "image/png";

  return {
    suggestedName: filename,
    types: [
      {
        description: "Image File",
        accept: {
          [mimeType]: [extension],
        },
      },
    ],
  };
}

async function triggerDownload(message) {
  const blob = await resolveDownloadBlob(message);
  if (!(blob instanceof Blob) || blob.size <= 0) {
    throw new Error("No downloadable image data available.");
  }

  const filename = buildDownloadFilename(message);

  if (typeof window.showSaveFilePicker === "function" && window.isSecureContext) {
    try {
      const handle = await window.showSaveFilePicker(buildDownloadPickerOptions(blob, filename));
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (error) {
      if (error?.name === "AbortError") {
        return false;
      }

      console.warn("showSaveFilePicker failed, falling back to anchor download.", error);
    }
  }

  triggerBlobDownload(blob, filename);
  return true;
}

function openImagePreview(src, alt) {
  if (!src || !dom.imagePreviewDialog || !dom.imagePreviewTarget) {
    return;
  }

  dom.imagePreviewTarget.src = src;
  dom.imagePreviewTarget.alt = alt || "放大预览图";
  if (!dom.imagePreviewDialog.open) {
    dom.imagePreviewDialog.showModal();
  }
}

function closeImagePreview() {
  if (!dom.imagePreviewDialog?.open) {
    return;
  }

  dom.imagePreviewDialog.close();
}

function resetImagePreview() {
  if (dom.imagePreviewTarget) {
    dom.imagePreviewTarget.removeAttribute("src");
  }
}

function getMimeTypeForFormat(format) {
  if (format === "jpeg") {
    return "image/jpeg";
  }

  if (format === "webp") {
    return "image/webp";
  }

  return "image/png";
}

async function readImageSize(sourceUrl) {
  const image = new Image();
  image.decoding = "async";
  image.src = sourceUrl;
  await image.decode();

  return `${image.naturalWidth}x${image.naturalHeight}`;
}

async function materializeBase64Image(base64, format) {
  const mimeType = getMimeTypeForFormat(format);
  const sourceUrl = `data:${mimeType};base64,${base64}`;
  const [blob, resultSize] = await Promise.all([
    fetch(sourceUrl).then((response) => response.blob()),
    readImageSize(sourceUrl),
  ]);

  return {
    blob,
    resultSize,
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("读取图片失败。"));
    reader.readAsDataURL(blob);
  });
}

async function ensurePersistedReferences(referenceList) {
  const references = cloneReferenceList(referenceList);

  for (const reference of references) {
    if (reference.assetId || !(reference.blob instanceof Blob)) {
      continue;
    }

    const assetId = createAssetId();
    const stored = await putBinaryAsset(assetId, reference.blob);

    if (stored) {
      reference.assetId = assetId;
      continue;
    }

    if (!reference.dataUrl) {
      reference.dataUrl = await blobToDataUrl(reference.blob);
    }
  }

  return references;
}

async function prepareRequestReferences(referenceList) {
  const references = cloneReferenceList(referenceList);
  const payload = [];

  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    let dataUrl = reference.dataUrl;

    if (!dataUrl) {
      let blob = reference.blob;
      if (!(blob instanceof Blob) && reference.assetId) {
        blob = await getBinaryAsset(reference.assetId);
      }

      if (!(blob instanceof Blob)) {
        const assetError = new Error("参考图缓存已失效，请重新粘贴参考图后再试。");
        assetError.diagnostics = {
          kind: "missing_reference_assets",
          referenceCount: references.length,
        };
        throw assetError;
      }

      reference.blob = blob;
      dataUrl = await blobToDataUrl(blob);
      reference.dataUrl = dataUrl;
    }

    payload.push({
      name: reference.name || `reference-${index + 1}.png`,
      type: reference.type || "image/png",
      dataUrl,
    });
  }

  return payload;
}

function createPastedReferenceFile(file, index) {
  const extension =
    file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png";

  return {
    id: createAssetId(),
    assetId: null,
    name: file.name || `pasted-reference-${Date.now()}-${index + 1}.${extension}`,
    type: file.type || "image/png",
    size: Number(file.size) || 0,
    dataUrl: null,
    previewUrl: URL.createObjectURL(file),
    blob: file,
    assetUnavailable: false,
  };
}

async function addComposerReferences(files) {
  const items = Array.from(files || []).filter(Boolean);
  if (!items.length) {
    return;
  }

  const availableSlots = MAX_REFERENCE_IMAGES - state.referenceImages.length;
  if (availableSlots <= 0) {
    setReferenceTip(`最多支持 ${MAX_REFERENCE_IMAGES} 张参考图。`, "warning");
    return;
  }

  let addedCount = 0;
  let unsupportedCount = 0;

  items.slice(0, availableSlots).forEach((file, index) => {
    if (!SUPPORTED_REFERENCE_TYPES.has(file.type)) {
      unsupportedCount += 1;
      return;
    }

    state.referenceImages.push(createPastedReferenceFile(file, index));
    addedCount += 1;
  });

  renderComposerReferenceStrip();

  if (!addedCount && unsupportedCount) {
    setReferenceTip("仅支持 PNG、JPEG、WEBP 作为参考图。", "warning");
    return;
  }

  if (unsupportedCount) {
    setReferenceTip(
      `已添加 ${addedCount} 张参考图。仅 PNG、JPEG、WEBP 会被保留。`,
      "warning"
    );
  }
}

function clearComposerReferenceImages(preservePreviewUrls = false) {
  if (!preservePreviewUrls) {
    revokeReferenceListObjectUrls(state.referenceImages);
  }

  state.referenceImages = [];
  renderComposerReferenceStrip();
}

function removeComposerReference(referenceId) {
  const nextReferences = [];

  for (const reference of state.referenceImages) {
    if (reference.id === referenceId) {
      revokeReferenceObjectUrl(reference);
      continue;
    }

    nextReferences.push(reference);
  }

  state.referenceImages = nextReferences;
  renderComposerReferenceStrip();
}

function consumeComposerReferenceImages() {
  const references = cloneReferenceList(state.referenceImages);
  clearComposerReferenceImages(true);
  return references;
}

function buildQuantityLabel(plan) {
  if (!plan) {
    return null;
  }

  const mainCount = plan.groups.find((group) => group.kind === "main")?.count || 0;
  const subCount = plan.groups.find((group) => group.kind === "sub")?.count || 0;

  if (mainCount || subCount) {
    const parts = [];
    if (mainCount) {
      parts.push(`主图${mainCount}`);
    }
    if (subCount) {
      parts.push(`副图${subCount}`);
    }
    return parts.join(" + ");
  }

  return plan.total > 1 ? `${plan.total} 张` : null;
}

function buildLoadingText(isRetry, batchItem) {
  const label = formatBatchItemLabel(batchItem);
  if (label) {
    return `正在生成 ${label}，请稍候。`;
  }

  return isRetry ? "正在重试生成，请稍候。" : "正在生成图片，请稍候。";
}

function normalizeAssistantMeta(meta) {
  if (!meta || typeof meta !== "object") {
    return null;
  }

  const assistantModel = String(meta.assistantModel || "").trim();
  if (!assistantModel) {
    return null;
  }

  return {
    optimized: meta.optimized !== false,
    assistantModel,
    reasoningEffort: normalizeAssistantReasoningEffort(meta.reasoningEffort),
  };
}

function cloneQueueItems(queue) {
  return Array.isArray(queue)
    ? queue.map((item) => ({
        ...item,
        assistantMeta: normalizeAssistantMeta(item?.assistantMeta),
      }))
    : [];
}

function buildPlanFromQueue(queue) {
  const items = Array.isArray(queue) ? queue.filter(Boolean) : [];
  const groups = [];

  for (const item of items) {
    const kind = item.kind || "standard";
    const existing = groups.find((group) => group.kind === kind);
    if (existing) {
      existing.count += 1;
      continue;
    }

    groups.push({ kind, count: 1 });
  }

  return {
    total: items.length || 1,
    source: "manual",
    mode: groups.some((group) => group.kind !== "standard") ? "ecommerce" : "standard",
    groups: groups.length ? groups : [{ kind: "standard", count: 1 }],
    ecommerceDerived: false,
  };
}

function shouldRunEcommerceAssist(plan, controls, settings, executionOptions) {
  if (executionOptions?.batchItem || (Array.isArray(executionOptions?.queue) && executionOptions.queue.length)) {
    return false;
  }

  return Boolean(
    controls?.ecommerceModeEnabled &&
      plan?.mode === "ecommerce" &&
      Number(plan?.total || 0) > 1 &&
      String(settings?.assistantModel || "").trim() &&
      String(settings?.apiKey || "").trim()
  );
}

function buildAssistantFallbackMessage(error, settings) {
  const diagnostics =
    error?.diagnostics && typeof error.diagnostics === "object"
      ? { ...error.diagnostics }
      : {
          kind: "assistant_prompt_failed",
          errorMessage: error?.message || "辅助提示词优化失败。",
        };

  diagnostics.kind = diagnostics.kind || "assistant_prompt_failed";
  diagnostics.errorMessage = diagnostics.errorMessage || error?.message || "辅助提示词优化失败。";
  diagnostics.assistantModel =
    diagnostics.assistantModel || String(settings?.assistantModel || "").trim() || null;
  diagnostics.reasoningEffort =
    diagnostics.reasoningEffort || normalizeAssistantReasoningEffort(settings?.assistantReasoningEffort);

  return {
    role: "system",
    type: "text",
    text: "辅助提示词优化失败，已回退到原始多图生成逻辑。",
    caption: [
      buildFailureCaption(diagnostics),
      diagnostics.upstreamSummary ? `上游摘要：${diagnostics.upstreamSummary}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    diagnostics,
    retryRequest: null,
    requestSize: null,
    resultSize: null,
    legacySizeRecord: false,
    outputFormat: null,
    filename: null,
    assetId: null,
    assetUnavailable: false,
    time: nowLabel(),
  };
}

async function optimizeEcommercePromptPlan({
  prompt,
  plan,
  queue,
  settings,
  controls,
  persistedReferences,
}) {
  const response = await fetch("/api/assist-prompt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      endpoint: settings.endpoint,
      apiKey: settings.apiKey,
      assistantModel: settings.assistantModel,
      assistantSystemPrompt: normalizeAssistantSystemPrompt(settings.assistantSystemPrompt),
      assistantReasoningEffort: settings.assistantReasoningEffort,
      prompt,
      plan,
      queue: queue.map((item) => ({
        kind: item.kind,
        kindIndex: item.kindIndex,
        kindCount: item.kindCount,
        globalIndex: item.globalIndex,
        total: item.total,
      })),
      referenceCount: persistedReferences.length,
      resolution: controls.resolution,
      aspect: controls.aspect,
      generationMode: controls.generationMode,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const assistError = new Error(payload.error || "辅助提示词优化失败。");
    assistError.diagnostics =
      payload.diagnostics && typeof payload.diagnostics === "object"
        ? payload.diagnostics
        : {
            kind: "assistant_prompt_failed",
            errorMessage: payload.error || "辅助提示词优化失败。",
          };
    throw assistError;
  }

  const prompts = Array.isArray(payload.perImagePrompts) ? payload.perImagePrompts : [];
  if (prompts.length !== queue.length) {
    const lengthError = new Error("辅助模型返回的提示词数量与生成队列不一致。");
    lengthError.diagnostics = {
      kind: "assistant_prompt_failed",
      assistantModel: payload.assistantModel || settings.assistantModel || null,
      reasoningEffort: payload.reasoningEffort || settings.assistantReasoningEffort || null,
      errorMessage: lengthError.message,
    };
    throw lengthError;
  }

  const assistantMeta = normalizeAssistantMeta({
    optimized: payload.optimized,
    assistantModel: payload.assistantModel || settings.assistantModel,
    reasoningEffort: payload.reasoningEffort || settings.assistantReasoningEffort,
  });

  if (!assistantMeta) {
    const metaError = new Error("辅助模型返回缺少可用模型信息。");
    metaError.diagnostics = {
      kind: "assistant_prompt_failed",
      errorMessage: metaError.message,
    };
    throw metaError;
  }

  const promptMap = new Map();
  prompts.forEach((entry, index) => {
    const globalIndex = Number(entry?.globalIndex || index + 1);
    const promptOverride = compactWhitespace(entry?.prompt || entry?.requestPrompt || "");
    if (globalIndex >= 1 && promptOverride) {
      promptMap.set(globalIndex, promptOverride);
    }
  });

  return {
    queue: queue.map((item, index) => {
      const promptOverride =
        promptMap.get(Number(item.globalIndex || index + 1)) ||
        compactWhitespace(prompts[index]?.prompt || prompts[index]?.requestPrompt || "");

      if (!promptOverride) {
        throw Object.assign(new Error(`第 ${index + 1} 张缺少优化后的提示词。`), {
          diagnostics: {
            kind: "assistant_prompt_failed",
            assistantModel: assistantMeta.assistantModel,
            reasoningEffort: assistantMeta.reasoningEffort,
            errorMessage: `第 ${index + 1} 张缺少优化后的提示词。`,
          },
        });
      }

      return {
        ...item,
        promptOverride,
        assistantMeta,
      };
    }),
    assistantMeta,
  };
}

async function generateSingleImageRequest({
  prompt,
  settings,
  controls,
  persistedReferences,
  requestReferences,
  batchItem = null,
  isRetry = false,
  replaceIndex = null,
}) {
  const startedAt = performance.now();
  const batchLabel = formatBatchItemLabel(batchItem);
  const promptForItem = buildPromptForBatchItem(prompt, batchItem);
  const requestPrompt = buildRequestPrompt(promptForItem, persistedReferences);
  const targetMessageIndex =
    Number.isInteger(replaceIndex) && replaceIndex >= 0 && replaceIndex < state.thread.length
      ? replaceIndex
      : null;

  try {
    if (targetMessageIndex === null) {
      await addMessage({
        role: "assistant",
        type: "loading",
        text: buildLoadingText(isRetry, batchItem),
        time: nowLabel(),
      });
    } else {
      await updateThreadMessageAt(
        targetMessageIndex,
        buildLoadingMessagePatch(buildLoadingText(isRetry, batchItem))
      );
    }

    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...settings,
        ...controls,
        prompt,
        requestPrompt,
        referenceImages: requestReferences,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const requestError = new Error(payload.error || "生成失败。");
      requestError.diagnostics = payload.diagnostics || null;
      throw requestError;
    }

    const requestSize =
      payload.request?.body?.size || getGenerationSize(controls.resolution, controls.aspect);
    if (!payload.imageBase64) {
      const missingImageError = new Error("生成成功但未返回图片数据。");
      missingImageError.diagnostics = {
        kind: "missing_image_data",
        model: settings.model || null,
        size: requestSize,
      };
      throw missingImageError;
    }

    const processed = await materializeBase64Image(payload.imageBase64, controls.outputFormat);
    const assetId = createAssetId();
    const cached = await putBinaryAsset(assetId, processed.blob);
    const objectUrl = URL.createObjectURL(processed.blob);
    const filenameParts = ["gpt-image-2", controls.aspect, controls.resolution];
    if (batchItem?.kind) {
      filenameParts.push(batchItem.kind);
    }
    if (batchItem?.globalIndex) {
      filenameParts.push(`item-${batchItem.globalIndex}`);
    }
    filenameParts.push(Date.now());
    const filename = filenameParts.join("-") + `.${controls.outputFormat}`;
    const totalElapsedMs = performance.now() - startedAt;

    dom.latencyValue.textContent = payload.latencyMs
      ? `总 ${formatDuration(totalElapsedMs)} / 上游 ${formatDuration(payload.latencyMs)}`
      : formatDuration(totalElapsedMs);

    const imagePatch = {
      type: "image",
      text: batchLabel || payload.revisedPrompt || "图片生成完成。",
      caption: [
        batchLabel ? `${batchLabel}。` : "",
        `请求 ${requestSize}，返回 ${processed.resultSize}。`,
        persistedReferences.length ? `参考图 ${persistedReferences.length} 张。` : "",
        payload.usage?.total_tokens ? `Token: ${payload.usage.total_tokens}。` : "",
        `总耗时 ${formatDuration(totalElapsedMs)}。`,
        payload.latencyMs ? `上游耗时 ${formatDuration(payload.latencyMs)}。` : "",
        cached ? "已缓存到当前浏览器。" : "浏览器缓存失败，仅保留当前会话预览。",
      ]
        .filter(Boolean)
        .join(" "),
      previewUrl: objectUrl,
      downloadUrl: objectUrl,
      requestSize,
      resultSize: processed.resultSize,
      legacySizeRecord: false,
      outputFormat: controls.outputFormat,
      filename,
      batchGroupId: batchItem?.batchGroupId || null,
      batchGroupIndex: batchItem?.globalIndex || null,
      batchGroupTotal: batchItem?.total || null,
      batchKind: batchItem?.kind || null,
      batchKindIndex: batchItem?.kindIndex || null,
      batchKindCount: batchItem?.kindCount || null,
      assetId: cached ? assetId : null,
      assetUnavailable: false,
      diagnostics: null,
      retryRequest: null,
      time: nowLabel(),
    };

    if (targetMessageIndex === null) {
      await updateLastMessage(imagePatch);
    } else {
      await updateThreadMessageAt(targetMessageIndex, imagePatch);
    }

    return true;
  } catch (error) {
    const totalElapsedMs = performance.now() - startedAt;
    const diagnostics = error.diagnostics || {
      kind: "local_request_failed",
      errorMessage: error.message || "生成失败。",
    };

    dom.latencyValue.textContent = formatDuration(totalElapsedMs);

    const failurePatch = {
      role: "system",
      type: "text",
      text: batchLabel ? `${batchLabel} 生成失败。` : error.message || "生成失败。",
      caption: [
        batchLabel ? `批次位置：${batchLabel}。` : "",
        buildFailureCaption(diagnostics),
        batchItem?.total > 1
          ? controls.generationMode === "parallel"
            ? "这是并行任务中的单张失败，其它并行请求会继续完成。"
            : "本次多图任务已在当前张停止。"
          : "",
        `本次耗时 ${formatDuration(totalElapsedMs)}。`,
        "若你刚修改了设置，可直接点下方“重试”。",
      ]
        .filter(Boolean)
        .join(" "),
      diagnostics,
      retryRequest: {
        prompt,
        controls,
        executionOptions: sanitizeRetryExecutionOptions(batchItem ? { batchItem } : null),
        references: cloneReferenceList(persistedReferences),
      },
      requestSize: null,
      resultSize: null,
      legacySizeRecord: false,
      outputFormat: null,
      filename: null,
      assetId: null,
      assetUnavailable: false,
      time: nowLabel(),
    };

    if (targetMessageIndex === null) {
      await updateLastMessage(failurePatch);
    } else {
      await updateThreadMessageAt(targetMessageIndex, failurePatch);
    }

    return false;
  }
}

async function generateImage(
  prompt,
  controlsOverride = null,
  isRetry = false,
  referenceImagesOverride = [],
  executionOptionsOverride = null
) {
  const settings = state.settings;
  const controls = {
    ...readControls(),
    ...(controlsOverride || {}),
  };
  controls.aspect = normalizeAspect(controls.aspect);
  controls.resolution = ["1k", "2k", "4k"].includes(controls.resolution) ? controls.resolution : "1k";
  controls.quantity = clampGenerationCount(controls.quantity);
  controls.generationMode = normalizeGenerationMode(controls.generationMode);
  controls.ecommerceModeEnabled = Boolean(controls.ecommerceModeEnabled);
  const inputReferences = cloneReferenceList(referenceImagesOverride);
  const executionOptions =
    executionOptionsOverride && typeof executionOptionsOverride === "object"
      ? { ...executionOptionsOverride }
      : null;
  const replaceIndex =
    Number.isInteger(executionOptions?.replaceIndex) && executionOptions.replaceIndex >= 0
      ? executionOptions.replaceIndex
      : null;
  const presetQueue =
    Array.isArray(executionOptions?.queue) && executionOptions.queue.length
      ? cloneQueueItems(executionOptions.queue)
      : null;
  let assistantMeta =
    normalizeAssistantMeta(executionOptions?.assistantMeta) ||
    normalizeAssistantMeta(executionOptions?.batchItem?.assistantMeta);

  let persistedReferences = [];
  let plan = null;
  let queue = [];
  let assistantFallbackMessage = null;
  let assistMessageIndex = null;

  try {
    state.activeRequestKind = "generate";
    if (isRetry && replaceIndex !== null) {
      await updateThreadMessageAt(
        replaceIndex,
        buildLoadingMessagePatch(buildLoadingText(true, executionOptions?.batchItem || null))
      );
    }

    persistedReferences = await ensurePersistedReferences(inputReferences);
    plan = executionOptions?.batchItem
      ? {
          total: Number(executionOptions.batchItem.total) || 1,
          source: "manual",
          mode: executionOptions.batchItem.kind === "standard" ? "standard" : "ecommerce",
          groups: [{ kind: executionOptions.batchItem.kind || "standard", count: 1 }],
          ecommerceDerived: false,
        }
      : presetQueue
        ? buildPlanFromQueue(presetQueue)
        : buildGenerationPlan(prompt, controls.quantity, {
            ecommerceModeEnabled: controls.ecommerceModeEnabled,
          });
    queue = executionOptions?.batchItem
      ? [{ ...executionOptions.batchItem }]
      : presetQueue
        ? presetQueue
        : buildGenerationQueue(plan);

    if (!assistantMeta && queue.length) {
      assistantMeta = normalizeAssistantMeta(queue[0]?.assistantMeta);
    }

    const shouldUseAssist = shouldRunEcommerceAssist(plan, controls, settings, executionOptions);

    if (!isRetry) {
      await addMessage({
        role: "user",
        type: "text",
        text: prompt,
        caption: formatRequestSummary({
          aspectLabel: getAspectLabel(controls.aspect),
          resolutionLabel: String(controls.resolution || "1k").toUpperCase(),
          outputFormat: controls.outputFormat,
          referenceCount: persistedReferences.length,
          quantityLabel: buildQuantityLabel(plan),
          generationModeLabel: plan.total > 1 ? getGenerationModeLabel(controls.generationMode) : "",
          ecommerceModeLabel: getEcommerceModeLabel(controls.ecommerceModeEnabled, plan),
          assistantSummary: shouldUseAssist
            ? formatAssistantSummary(settings.assistantModel, settings.assistantReasoningEffort)
            : assistantMeta
              ? formatAssistantSummary(assistantMeta.assistantModel, assistantMeta.reasoningEffort)
              : "",
        }),
        time: nowLabel(),
        references: cloneReferenceList(persistedReferences),
      });
    }

    if (shouldUseAssist) {
      const assistMetaForPending =
        assistantMeta ||
        normalizeAssistantMeta({
          assistantModel: settings.assistantModel,
          reasoningEffort: settings.assistantReasoningEffort,
        });
      const assistPlan = {
        total: Number(plan?.total) || queue.length || 1,
        mode: plan?.mode || "ecommerce",
        groups: Array.isArray(plan?.groups) ? plan.groups : [],
      };

      if (isRetry && replaceIndex !== null && state.thread[replaceIndex]?.type === "assist") {
        assistMessageIndex = replaceIndex;
        await updateThreadMessageAt(
          assistMessageIndex,
          buildAssistProgressMessage({
            assistState: "pending",
            assistStage: "requesting",
            assistMeta: assistMetaForPending,
            assistPlan,
            assistPrompts: [],
            diagnostics: null,
          })
        );
      } else {
        assistMessageIndex = await addMessage(
          buildAssistProgressMessage({
            assistState: "pending",
            assistStage: "requesting",
            assistMeta: assistMetaForPending,
            assistPlan,
            assistPrompts: [],
            diagnostics: null,
          })
        );
      }
    }

    if (shouldUseAssist) {
      try {
        const optimized = await optimizeEcommercePromptPlan({
          prompt,
          plan,
          queue,
          settings,
          controls,
          persistedReferences,
        });
        queue = optimized.queue;
        assistantMeta = optimized.assistantMeta;
        if (assistMessageIndex !== null) {
          await updateThreadMessageAt(
            assistMessageIndex,
            buildAssistProgressMessage({
              assistState: "complete",
              assistStage: "complete",
              assistMeta: assistantMeta,
              assistPlan: {
                total: Number(plan?.total) || queue.length || 1,
                mode: plan?.mode || "ecommerce",
                groups: Array.isArray(plan?.groups) ? plan.groups : [],
              },
              assistPrompts: queue.map((item, index) => ({
                globalIndex: Number(item.globalIndex || index + 1),
                kind: item.kind || "standard",
                prompt: item.promptOverride || buildPromptForBatchItem(prompt, item),
              })),
              diagnostics: null,
            })
          );
        }
      } catch (error) {
        if (assistMessageIndex !== null) {
          await updateThreadMessageAt(
            assistMessageIndex,
            buildAssistProgressMessage({
              assistState: "failed",
              assistStage: "fallback",
              assistMeta:
                assistantMeta ||
                normalizeAssistantMeta({
                  assistantModel:
                    error?.diagnostics?.assistantModel || settings.assistantModel || null,
                  reasoningEffort:
                    error?.diagnostics?.reasoningEffort || settings.assistantReasoningEffort || null,
                }),
              assistPlan: {
                total: Number(plan?.total) || queue.length || 1,
                mode: plan?.mode || "ecommerce",
                groups: Array.isArray(plan?.groups) ? plan.groups : [],
              },
              assistPrompts: [],
              diagnostics: error?.diagnostics || null,
            })
          );
          assistantFallbackMessage = null;
        } else {
          assistantFallbackMessage = buildAssistantFallbackMessage(error, settings);
        }
      }
    }

    if (assistantFallbackMessage) {
      await addMessage(assistantFallbackMessage);
    }

    const requestReferences = await prepareRequestReferences(persistedReferences);
    const session = createGenerationSession({
      prompt,
      controls,
      settings,
      persistedReferences,
      requestReferences,
      queue,
      mode: controls.generationMode,
      isRetry,
      replaceIndex,
    });
    if (session.mode === "parallel" && session.queue.length > 1) {
      await runParallelGenerationSession(session);
    } else {
      await runGenerationSession(session);
    }
  } catch (error) {
    const diagnostics = error.diagnostics || {
      kind: "local_request_failed",
      errorMessage: error.message || "生成失败。",
    };

    if (assistMessageIndex !== null && state.thread[assistMessageIndex]?.assistState === "pending") {
      await updateThreadMessageAt(
        assistMessageIndex,
        buildAssistProgressMessage({
          assistState: "failed",
          assistStage: "fallback",
          assistMeta:
            assistantMeta ||
            normalizeAssistantMeta({
              assistantModel: settings.assistantModel,
              reasoningEffort: settings.assistantReasoningEffort,
            }),
          assistPlan: plan,
          assistPrompts: [],
          diagnostics,
        })
      );
    }

    const failureMessage = {
      role: "system",
      type: "text",
      text: error.message || "生成失败。",
      caption: buildFailureCaption(diagnostics),
      diagnostics,
      retryRequest: {
        prompt,
        controls,
        executionOptions: sanitizeRetryExecutionOptions({
          ...(executionOptions || {}),
          assistantMeta,
          queue,
        }),
        references: cloneReferenceList(persistedReferences),
      },
      requestSize: null,
      resultSize: null,
      legacySizeRecord: false,
      outputFormat: null,
      filename: null,
      assetId: null,
      assetUnavailable: false,
      time: nowLabel(),
    };

    if (replaceIndex !== null) {
      await updateThreadMessageAt(replaceIndex, failureMessage);
    } else {
      await addMessage(failureMessage);
    }

    state.generationSession = null;
  } finally {
    state.activeRequestKind = null;
    renderThread();
    updateStatus();
  }
}

async function reversePromptFromImages(
  prompt,
  referenceImages,
  isRetry = false,
  options = null
) {
  const settings = state.settings;
  const cleanPrompt = compactWhitespace(prompt);
  const inputReferences = cloneReferenceList(referenceImages);
  const replaceIndex =
    Number.isInteger(options?.replaceIndex) && options.replaceIndex >= 0 ? options.replaceIndex : null;
  let persistedReferences = [];

  try {
    if (!String(settings.apiKey || "").trim()) {
      syncSettingsForm();
      dom.settingsDialog?.showModal();
      return false;
    }

    if (!inputReferences.length) {
      const missingReferenceError = new Error("反推模式至少需要 1 张图片。");
      missingReferenceError.diagnostics = {
        kind: "reverse_prompt_failed",
        errorMessage: missingReferenceError.message,
      };
      throw missingReferenceError;
    }

    state.activeRequestKind = "reverse";
    state.isGenerating = true;
    updateGenerationControls();

    persistedReferences = await ensurePersistedReferences(inputReferences);
    const requestReferences = await prepareRequestReferences(persistedReferences);
    const reverseMeta = normalizeReverseMeta({
      assistantModel: settings.assistantModel,
      reasoningEffort: settings.assistantReasoningEffort,
      imageCount: persistedReferences.length,
    });
    const retryRequest = {
      prompt: cleanPrompt,
      controls: null,
      executionOptions: null,
      references: cloneReferenceList(persistedReferences),
    };

    if (!isRetry) {
      await addMessage({
        role: "user",
        type: "text",
        text: cleanPrompt || "图片反推",
        caption: formatRequestSummary({
          referenceCount: persistedReferences.length,
          assistantSummary: formatReverseSummary(
            reverseMeta?.assistantModel,
            reverseMeta?.reasoningEffort
          ),
        }),
        time: nowLabel(),
        references: cloneReferenceList(persistedReferences),
      });
    }

    const pendingPatch = buildReverseProgressMessage({
      reverseState: "pending",
      reverseStage: "requesting",
      reverseMeta,
      reverseResult: null,
      diagnostics: null,
      references: persistedReferences,
      promptText: cleanPrompt,
      retryRequest,
    });

    let messageIndex = replaceIndex;
    if (Number.isInteger(messageIndex) && messageIndex >= 0 && messageIndex < state.thread.length) {
      await updateThreadMessageAt(messageIndex, pendingPatch);
    } else {
      messageIndex = await addMessage(pendingPatch);
    }

    const startedAt = performance.now();
    const response = await fetch("/api/reverse-prompt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        endpoint: settings.endpoint,
        apiKey: settings.apiKey,
        assistantModel: settings.assistantModel,
        reversePromptSystemPrompt: normalizeReversePromptSystemPrompt(
          settings.reversePromptSystemPrompt
        ),
        assistantReasoningEffort: settings.assistantReasoningEffort,
        prompt: cleanPrompt,
        referenceImages: requestReferences,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const requestError = new Error(payload.error || "图片反推失败。");
      requestError.diagnostics =
        payload.diagnostics && typeof payload.diagnostics === "object"
          ? payload.diagnostics
          : {
              kind: "reverse_prompt_failed",
              errorMessage: payload.error || "图片反推失败。",
            };
      throw requestError;
    }

    const reverseResult = normalizeReversePromptResult(payload.result);
    if (!reverseResult) {
      const invalidResultError = new Error("反推结果缺少可用提示词。");
      invalidResultError.diagnostics = {
        kind: "reverse_prompt_failed",
        assistantModel: payload.assistantModel || settings.assistantModel || null,
        reasoningEffort: payload.reasoningEffort || settings.assistantReasoningEffort || null,
        errorMessage: invalidResultError.message,
      };
      throw invalidResultError;
    }

    const completedMeta = normalizeReverseMeta({
      assistantModel: payload.assistantModel || settings.assistantModel,
      reasoningEffort: payload.reasoningEffort || settings.assistantReasoningEffort,
      imageCount: payload.imageCount || persistedReferences.length,
    });
    const totalElapsedMs = performance.now() - startedAt;
    dom.latencyValue.textContent = payload.latencyMs
      ? `总 ${formatDuration(totalElapsedMs)} / 上游 ${formatDuration(payload.latencyMs)}`
      : formatDuration(totalElapsedMs);

    await updateThreadMessageAt(
      messageIndex,
      buildReverseProgressMessage({
        reverseState: "complete",
        reverseStage: "complete",
        reverseMeta: completedMeta,
        reverseResult,
        diagnostics: null,
        references: persistedReferences,
        promptText: cleanPrompt,
        retryRequest,
      })
    );

    return true;
  } catch (error) {
    const diagnostics = error.diagnostics || {
      kind: "reverse_prompt_failed",
      errorMessage: error.message || "图片反推失败。",
    };
    dom.latencyValue.textContent = "-";

    const failurePatch = buildReverseProgressMessage({
      reverseState: "failed",
      reverseStage: "failed",
      reverseMeta: normalizeReverseMeta({
        assistantModel: diagnostics.assistantModel || settings.assistantModel,
        reasoningEffort: diagnostics.reasoningEffort || settings.assistantReasoningEffort,
        imageCount: persistedReferences.length || inputReferences.length,
      }),
      reverseResult: null,
      diagnostics,
      references: persistedReferences.length ? persistedReferences : inputReferences,
      promptText: cleanPrompt,
      retryRequest: {
        prompt: cleanPrompt,
        controls: null,
        executionOptions: null,
        references: cloneReferenceList(
          persistedReferences.length ? persistedReferences : inputReferences
        ),
      },
    });

    if (Number.isInteger(replaceIndex) && replaceIndex >= 0 && replaceIndex < state.thread.length) {
      await updateThreadMessageAt(replaceIndex, failurePatch);
    } else {
      await addMessage(failurePatch);
    }

    return false;
  } finally {
    state.isGenerating = false;
    state.activeRequestKind = null;
    renderThread();
    updateStatus();
  }
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const payload = await response.json();
    dom.healthValue.textContent = payload.ok ? "在线" : "异常";
  } catch (error) {
    dom.healthValue.textContent = "离线";
  }
}

function extractImageFilesFromClipboard(event) {
  const items = Array.from(event.clipboardData?.items || []);
  return items
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

function attachEvents() {
  document.querySelectorAll("#composerModeGroup [data-composer-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setComposerMode(button.dataset.composerMode, { focus: true });
      updateStatus();
    });
  });

  document.querySelectorAll("#resolutionGroup [data-resolution]").forEach((button) => {
    button.addEventListener("click", () => {
      state.resolution = button.dataset.resolution;
      setActiveSegment("resolutionGroup", "resolution", state.resolution);
      updateStatus();
    });
  });

  document.querySelectorAll("#aspectGroup [data-aspect]").forEach((button) => {
    button.addEventListener("click", () => {
      state.aspect = button.dataset.aspect;
      setActiveSegment("aspectGroup", "aspect", state.aspect);
      updateStatus();
    });
  });

  if (dom.quantityInput) {
    dom.quantityInput.addEventListener("input", () => {
      state.quantity = clampGenerationCount(dom.quantityInput.value);
      updateQuantityHint();
    });

    dom.quantityInput.addEventListener("change", () => {
      state.quantity = clampGenerationCount(dom.quantityInput.value);
      dom.quantityInput.value = String(state.quantity);
      updateQuantityHint();
    });
  }

  document.querySelectorAll("#generationModeGroup [data-generation-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.generationMode = normalizeGenerationMode(button.dataset.generationMode);
      setActiveSegment("generationModeGroup", "generationMode", state.generationMode);
      updateStatus();
    });
  });

  if (dom.ecommerceModeInput) {
    dom.ecommerceModeInput.addEventListener("change", () => {
      state.ecommerceModeEnabled = Boolean(dom.ecommerceModeInput.checked);
      updateQuantityHint(dom.promptInput.value);
    });
  }

  dom.composerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.isGenerating || state.generationSession?.paused) {
      return;
    }

    const prompt = dom.promptInput.value.trim();
    const composerMode = normalizeComposerMode(state.composerMode);
    const requiresPrompt = composerMode !== "reverse";
    if (requiresPrompt && !prompt) {
      dom.promptInput.focus();
      return;
    }

    if (!state.settings.apiKey.trim()) {
      syncSettingsForm();
      dom.settingsDialog.showModal();
      return;
    }

    const references = consumeComposerReferenceImages();
    if (composerMode === "reverse" && !references.length) {
      state.referenceImages = references;
      renderComposerReferenceStrip();
      dom.promptInput.focus();
      setReferenceTip("反推模式至少需要 1 张图片。", "warning");
      return;
    }

    dom.promptInput.value = "";
    if (composerMode === "reverse") {
      await reversePromptFromImages(prompt, references, false, null);
    } else {
      await generateImage(prompt, null, false, references);
    }
  });

  if (dom.pauseGenerationButton) {
    dom.pauseGenerationButton.addEventListener("click", () => {
      requestPauseBatchGeneration();
    });
  }

  if (dom.resumeGenerationButton) {
    dom.resumeGenerationButton.addEventListener("click", async () => {
      await resumeBatchGeneration();
    });
  }

  dom.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      dom.composerForm.requestSubmit();
    }
  });

  dom.promptInput.addEventListener("input", () => {
    updateQuantityHint(dom.promptInput.value);
  });

  dom.promptInput.addEventListener("paste", async (event) => {
    const imageFiles = extractImageFilesFromClipboard(event);
    if (!imageFiles.length) {
      return;
    }

    event.preventDefault();
    await addComposerReferences(imageFiles);
  });

  dom.clearReferenceImagesButton.addEventListener("click", () => {
    clearComposerReferenceImages();
  });

  dom.clearThreadButton.addEventListener("click", async () => {
    if (state.isGenerating || state.generationSession?.paused) {
      return;
    }

    await clearThread();
    dom.latencyValue.textContent = "-";
  });

  dom.openSettingsButton.addEventListener("click", () => {
    syncSettingsForm();
    dom.settingsDialog.showModal();
  });

  dom.closeSettingsButton.addEventListener("click", () => {
    dom.settingsDialog.close();
  });

  dom.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings = {
      endpoint: dom.endpointInput.value.trim() || DEFAULT_SETTINGS.endpoint,
      apiKey: dom.apiKeyInput.value.trim(),
      model: dom.modelInput.value.trim() || DEFAULT_SETTINGS.model,
      assistantModel: dom.assistantModelInput.value.trim() || DEFAULT_SETTINGS.assistantModel,
      assistantSystemPrompt: normalizeAssistantSystemPrompt(dom.assistantSystemPromptInput.value),
      reversePromptSystemPrompt: normalizeReversePromptSystemPrompt(
        dom.reversePromptSystemPromptInput?.value
      ),
      assistantReasoningEffort: normalizeAssistantReasoningEffort(
        dom.assistantReasoningEffortSelect.value
      ),
      moderation: dom.moderationSelect.value,
    };
    saveJson(STORAGE_KEY, state.settings);
    updateStatus();
    dom.settingsDialog.close();
  });

  dom.resetSettingsButton.addEventListener("click", () => {
    state.settings = { ...DEFAULT_SETTINGS };
    saveJson(STORAGE_KEY, state.settings);
    syncSettingsForm();
    updateStatus();
  });

  dom.closeImagePreviewButton.addEventListener("click", () => {
    closeImagePreview();
  });

  dom.imagePreviewDialog.addEventListener("click", (event) => {
    if (event.target === dom.imagePreviewDialog) {
      closeImagePreview();
    }
  });

  dom.imagePreviewDialog.addEventListener("close", () => {
    resetImagePreview();
  });
}

function buildFailureCaption(diagnostics) {
  const kind = diagnostics?.kind || "";
  if (!diagnostics) {
    return "请检查设置中的 API 端点、密钥和模型名后再试。";
  }

  if (kind === "upstream_fetch_failed") {
    return "本地代理连上游接口都没连通，常见原因是端点错误、DNS/TLS 问题或第三方网关故障。";
  }

  if (kind === "upstream_http_error") {
    return "上游接口已返回失败状态。先看下面的状态码、端点和上游摘要，再决定重试还是改模型。";
  }

  if (kind === "missing_image_data") {
    return "上游返回了成功响应，但响应体里没有可用的图片数据。";
  }

  if (kind === "local_request_failed") {
    return "浏览器到本地代理的请求失败了，先确认本地服务是否仍在运行。";
  }

  if (kind === "missing_reference_assets") {
    return "这次重试需要的参考图缓存已经丢失，请重新粘贴参考图后再发起请求。";
  }

  if (kind === "assistant_prompt_failed") {
    return "辅助文本模型调用失败，系统已回退到原始多图提示词。";
  }

  if (kind === "reverse_prompt_failed") {
    return "图片反推调用失败，请检查文本模型、端点兼容性或更换模型后再试。";
  }

  return "请检查设置中的 API 端点、密钥和模型名后再试。";
}

function createCopyPromptButton(prompt, label = "复制", className = "secondary-button") {
  return createAsyncStatusButton({
    label,
    pendingLabel: "复制中...",
    successLabel: "已复制",
    failureLabel: "复制失败",
    className,
    action: () => writeTextToClipboard(prompt),
  });
}

function primeComposerWithPrompt(prompt, options = {}) {
  const cleanPrompt = compactWhitespace(prompt);
  if (!cleanPrompt) {
    return;
  }

  const nextReferences = Array.isArray(options.references)
    ? cloneReferenceList(options.references)
    : [];

  if (options.clearReferences !== false) {
    clearComposerReferenceImages();
  }

  if (nextReferences.length) {
    state.referenceImages = nextReferences;
    renderComposerReferenceStrip();
  }

  setComposerMode("generate");
  if (dom.promptInput) {
    dom.promptInput.value = cleanPrompt;
    dom.promptInput.focus();
  }
  updateQuantityHint(cleanPrompt);
}

async function continueGenerateFromPrompt(prompt, options = {}) {
  const cleanPrompt = compactWhitespace(prompt);
  if (!cleanPrompt) {
    return false;
  }

  const references = Array.isArray(options.references)
    ? cloneReferenceList(options.references)
    : [];

  primeComposerWithPrompt(cleanPrompt, {
    clearReferences: references.length === 0,
    references,
  });
  return true;
}

function createFillPromptButton(prompt, label = "填入输入框", className = "secondary-button", options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", () => {
    const references = Array.isArray(options.references)
      ? cloneReferenceList(options.references)
      : [];
    primeComposerWithPrompt(prompt, {
      clearReferences: references.length === 0,
      references,
    });
  });
  return button;
}

function createGeneratePromptButton(
  prompt,
  label = "继续生图",
  className = "primary-button",
  options = {}
) {
  return createAsyncStatusButton({
    label,
    pendingLabel: "填入中...",
    successLabel: "已填入",
    failureLabel: "填入失败",
    className,
    action: () => continueGenerateFromPrompt(prompt, options),
  });
}

function buildPromptActionBar(prompt, options = {}) {
  const cleanPrompt = compactWhitespace(prompt);
  if (!cleanPrompt) {
    return null;
  }

  const actions = document.createElement("div");
  actions.className = "reverse-actions";

  if (options.allowCopy !== false) {
    actions.append(createCopyPromptButton(cleanPrompt, options.copyLabel || "复制"));
  }

  if (options.allowFill !== false) {
    actions.append(
      createFillPromptButton(
        cleanPrompt,
        options.fillLabel || "填入输入框",
        "secondary-button",
        {
          references: options.references,
        }
      )
    );
  }

  if (options.allowGenerate !== false) {
    actions.append(
      createGeneratePromptButton(
        cleanPrompt,
        options.generateLabel || "继续生图",
        "primary-button",
        {
          references: options.references,
        }
      )
    );
  }

  return actions;
}

function updateGenerationControlAvailability() {
  const reverseMode = normalizeComposerMode(state.composerMode) === "reverse";
  const controlCard = document.querySelector(".control-card.control-card-scrollable");
  if (controlCard) {
    controlCard.classList.toggle("is-reverse-mode", reverseMode);
  }

  const fieldTargets = [
    dom.quantityInput,
    dom.ecommerceModeInput,
    dom.outputFormatSelect,
    dom.qualitySelect,
    dom.backgroundSelect,
    document.querySelector("#resolutionGroup"),
    document.querySelector("#aspectGroup"),
    document.querySelector("#generationModeGroup"),
  ];

  fieldTargets.forEach((target) => {
    const field = target?.closest?.(".field");
    if (field) {
      field.classList.toggle("is-mode-muted", reverseMode);
    }
  });

  document.querySelectorAll("#resolutionGroup button, #aspectGroup button, #generationModeGroup button").forEach((button) => {
    button.disabled = reverseMode;
  });

  [dom.quantityInput, dom.ecommerceModeInput, dom.outputFormatSelect, dom.qualitySelect, dom.backgroundSelect].forEach((control) => {
    if (control) {
      control.disabled = reverseMode;
    }
  });
}

function updateQuantityHint(prompt = dom.promptInput?.value || "") {
  if (!dom.quantityHint) {
    return;
  }

  if (normalizeComposerMode(state.composerMode) === "reverse") {
    dom.quantityHint.textContent =
      "反推模式不会使用图片数量、电商拆图、并行排队或输出格式设置；只会读取当前粘贴的图片和补充文本要求。";
    return;
  }

  const plan = buildGenerationPlan(prompt, state.quantity, {
    ecommerceModeEnabled: state.ecommerceModeEnabled,
  });
  const parts = [describeQuantitySource(plan.source, plan.total)];
  const generationMode = normalizeGenerationMode(state.generationMode);

  if (plan.mode === "ecommerce") {
    const mainCount = plan.groups.find((group) => group.kind === "main")?.count || 0;
    const subCount = plan.groups.find((group) => group.kind === "sub")?.count || 0;
    parts.push(
      plan.ecommerceDerived
        ? `电商模式已启用，默认按主图 ${mainCount} 张、副图 ${subCount} 张规划。`
        : `已识别主图 ${mainCount} 张、副图 ${subCount} 张。`
    );
  }

  if (plan.total > 1) {
    parts.push(
      generationMode === "parallel"
        ? "将并行发起多张请求，完成顺序可能不同，且不支持暂停或恢复。"
        : "将按同一提示词顺序排队生成多张变体。"
    );
  }

  parts.push("可输入 1-20，也可在提示词里直接写“10张”或“1张主图+9张副图”。");
  dom.quantityHint.textContent = parts.join(" ");
}

function updateStatus() {
  const reverseMode = normalizeComposerMode(state.composerMode) === "reverse";
  dom.modelValue.textContent = reverseMode
    ? `${state.settings.assistantModel || DEFAULT_SETTINGS.assistantModel} / 反推`
    : state.settings.model || "gpt-image-2";
  dom.messageCountValue.textContent = String(state.thread.length);
  const requestSize = getGenerationSize(state.resolution, state.aspect);
  dom.resolutionHint.textContent = reverseMode
    ? `当前反推使用文本模型 ${state.settings.assistantModel || DEFAULT_SETTINGS.assistantModel}，不会读取左侧生成尺寸、画幅和质量设置。`
    : `发送给模型的生成尺寸：${requestSize}。1K / 2K / 4K 会直接改变请求像素。`;
  if (dom.quantityInput) {
    dom.quantityInput.value = String(clampGenerationCount(state.quantity));
  }
  if (dom.ecommerceModeInput) {
    dom.ecommerceModeInput.checked = Boolean(state.ecommerceModeEnabled);
  }
  updateComposerModeUi();
  updateGenerationControlAvailability();
  updateQuantityHint();
  updateGenerationControls();
}

function renderReverseMessage(item, itemIndex) {
  const details = document.createElement("details");
  details.className = `assist-details reverse-details is-${item.reverseState || "pending"}`;
  details.open = item.reverseExpanded !== false;
  details.addEventListener("toggle", () => {
    persistReverseExpandedState(itemIndex, details.open);
  });

  const summary = document.createElement("summary");
  summary.className = "assist-summary";

  const summaryMain = document.createElement("div");
  summaryMain.className = "assist-summary-main";

  const title = document.createElement("span");
  title.className = "assist-summary-title";
  title.textContent = item.text || "图片反推提示词";

  const metaLine = document.createElement("span");
  metaLine.className = "assist-summary-meta";
  metaLine.textContent = item.caption || "图片反推";

  summaryMain.append(title, metaLine);

  const statePill = document.createElement("span");
  statePill.className = "pill assist-state-pill";
  statePill.textContent = getReverseStateLabel(item.reverseState);

  summary.append(summaryMain, statePill);
  details.append(summary);

  const content = document.createElement("div");
  content.className = "assist-content reverse-content";

  if (item.reverseState === "pending") {
    const loading = document.createElement("div");
    loading.innerHTML = `
      <div class="loading-dots" aria-label="loading">
        <span></span><span></span><span></span>
      </div>
    `;
    content.append(loading);
  }

  content.append(renderMutedParagraph(getReverseStageText(item.reverseStage, item.reverseMeta)));

  if (item.references?.length) {
    const referenceSection = renderReferenceSection(item.references, "分析图片");
    if (referenceSection) {
      content.append(referenceSection);
    }
  }

  if (item.reverseResult?.summary) {
    content.append(renderParagraph(item.reverseResult.summary));
  }

  const primaryCnCard = createReversePromptCard("中文主提示词", item.reverseResult?.promptCn, {
    primary: true,
    references: item.references,
  });
  if (primaryCnCard) {
    content.append(primaryCnCard);
  }

  const primaryEnCard = createReversePromptCard("英文主提示词", item.reverseResult?.promptEn, {
    references: item.references,
  });
  if (primaryEnCard) {
    content.append(primaryEnCard);
  }

  const negativePromptCard = createReversePromptCard("负向提示词", item.reverseResult?.negativePrompt, {
    copyLabel: "复制负向词",
    fillLabel: "填入输入框",
    allowGenerate: false,
  });
  if (negativePromptCard) {
    content.append(negativePromptCard);
  }

  const styleTags = renderReverseTagList("风格标签", item.reverseResult?.styleTags);
  if (styleTags) {
    content.append(styleTags);
  }

  const breakdown = renderReverseBreakdown(item.reverseResult?.visualBreakdown);
  if (breakdown) {
    const section = document.createElement("section");
    section.className = "reverse-breakdown-section";
    const heading = document.createElement("div");
    heading.className = "message-section-title";
    heading.textContent = "画面拆解";
    section.append(heading, breakdown);
    content.append(section);
  }

  const variants = renderReverseVariants(item.reverseResult);
  if (variants) {
    const section = document.createElement("section");
    section.className = "reverse-variant-section";
    const heading = document.createElement("div");
    heading.className = "message-section-title";
    heading.textContent = "可选变体";
    section.append(heading, variants);
    content.append(section);
  }

  const uncertainPoints = renderReversePointList("不确定项", item.reverseResult?.uncertainPoints);
  if (uncertainPoints) {
    content.append(uncertainPoints);
  }

  if (item.reverseState === "failed") {
    const retryActions = document.createElement("div");
    retryActions.className = "reverse-actions";
    retryActions.append(
      createAsyncStatusButton({
        label: "重试反推",
        pendingLabel: "重试中...",
        successLabel: "已开始",
        failureLabel: "重试失败",
        className: "secondary-button",
        action: () => retryReverseMessage(itemIndex),
      })
    );
    content.append(retryActions);
  }

  if (item.diagnostics) {
    const panel = renderDiagnosticPanel(item.diagnostics);
    if (panel) {
      content.append(panel);
    }
  }

  details.append(content);
  return details;
}

async function bootstrap() {
  syncSettingsForm();
  setActiveSegment("resolutionGroup", "resolution", state.resolution);
  setActiveSegment("aspectGroup", "aspect", state.aspect);
  setActiveSegment("generationModeGroup", "generationMode", state.generationMode);
  renderComposerReferenceStrip();
  renderThread();
  updateStatus();
  attachEvents();
  await hydrateThreadAssets();
  renderThread();
  await checkHealth();
}

window.addEventListener("beforeunload", () => {
  for (const item of state.thread) {
    revokeThreadMessageAssets(item);
  }

  revokeReferenceListObjectUrls(state.referenceImages);
});

bootstrap().catch((error) => {
  console.error("Bootstrap failed.", error);
});
