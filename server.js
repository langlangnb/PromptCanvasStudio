const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const HOST = "127.0.0.1";
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_JSON_BODY_SIZE = 80 * 1024 * 1024;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const GENERATION_SIZE_MAP = {
  "1k": {
    square: "1024x1024",
    landscape: "1024x576",
    portrait: "576x1024",
    nineSixteen: "576x1024",
    threeFour: "768x1024",
    fourThree: "1024x768",
  },
  "2k": {
    square: "2048x2048",
    landscape: "2048x1152",
    portrait: "1152x2048",
    nineSixteen: "1152x2048",
    threeFour: "1536x2048",
    fourThree: "2048x1536",
  },
  "4k": {
    square: "4096x4096",
    landscape: "4096x2304",
    portrait: "2304x4096",
    nineSixteen: "2304x4096",
    threeFour: "3072x4096",
    fourThree: "4096x3072",
  },
};

function truncateText(value, limit = 320) {
  const text = String(value || "");
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit)}...`;
}

function summarizeUpstreamDetails(data) {
  if (!data) {
    return null;
  }

  if (typeof data?.error?.message === "string" && data.error.message.trim()) {
    return truncateText(data.error.message.trim());
  }

  if (typeof data?.message === "string" && data.message.trim()) {
    return truncateText(data.message.trim());
  }

  if (typeof data?.raw === "string" && data.raw.trim()) {
    return truncateText(data.raw.trim());
  }

  try {
    return truncateText(JSON.stringify(data));
  } catch (error) {
    return null;
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function normalizeEndpoint(rawEndpoint, mode = "generate") {
  const trimmed = String(rawEndpoint || "").trim();
  const suffix = mode === "edit" ? "/images/edits" : "/images/generations";

  if (!trimmed) {
    return `https://api.openai.com/v1${suffix}`;
  }

  if (/\/images\/(generations|edits)\/?$/i.test(trimmed)) {
    return trimmed.replace(/\/images\/(generations|edits)\/?$/i, suffix);
  }

  return `${trimmed.replace(/\/+$/, "")}${suffix}`;
}

function normalizeChatEndpoint(rawEndpoint) {
  const trimmed = String(rawEndpoint || "").trim();
  const suffix = "/chat/completions";

  if (!trimmed) {
    return `https://api.openai.com/v1${suffix}`;
  }

  if (/\/chat\/completions\/?$/i.test(trimmed)) {
    return trimmed.replace(/\/chat\/completions\/?$/i, suffix);
  }

  if (/\/responses\/?$/i.test(trimmed)) {
    return trimmed.replace(/\/responses\/?$/i, suffix);
  }

  if (/\/images\/(generations|edits)\/?$/i.test(trimmed)) {
    return trimmed.replace(/\/images\/(generations|edits)\/?$/i, suffix);
  }

  return `${trimmed.replace(/\/+$/, "")}${suffix}`;
}

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
  "你的任务是根据用户提供的图片和补充要求，输出可直接用于 gpt-image-2 这类图像模型的高质量提示词。",
  "优先基于图片中的可见证据描述主体、构图、景别、视角、布光、背景、材质、颜色、风格和氛围。",
  "不确定或推测性的内容必须单独列到 uncertain_points，不要混入主提示词。",
  "不要臆造品牌、商标、文字、水印内容、产品型号或图片中看不清的细节。",
  "主提示词要适合直接发给图像模型，语义完整、具体、可执行。",
  "如果用户补充了用途，例如电商主图、海报、写实摄影、插画风格，要在结果中体现。",
  "输出必须严格遵守指定 JSON 结构，不要输出 markdown，不要解释，不要代码块。",
].join("\n");

function normalizeAssistantSystemPrompt(value) {
  const prompt = String(value || "").trim();
  return prompt || DEFAULT_ASSISTANT_SYSTEM_PROMPT;
}

function normalizeReversePromptSystemPrompt(value) {
  const prompt = String(value || "").trim();
  return prompt || DEFAULT_REVERSE_PROMPT_SYSTEM_PROMPT;
}

function normalizeReferenceImages(rawReferences) {
  if (!Array.isArray(rawReferences)) {
    return [];
  }

  return rawReferences
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      name:
        typeof item.name === "string" && item.name.trim()
          ? item.name.trim()
          : `reference-${index + 1}.png`,
      type:
        typeof item.type === "string" && item.type.trim()
          ? item.type.trim()
          : "image/png",
      dataUrl: typeof item.dataUrl === "string" ? item.dataUrl.trim() : "",
    }))
    .filter((item) => item.dataUrl.startsWith("data:"));
}

function buildRequestParams(input) {
  const resolution = ["1k", "2k", "4k"].includes(input.resolution) ? input.resolution : "1k";
  const rawAspect = String(input.aspect || "").trim();
  const aspect =
    rawAspect === "portrait"
      ? "nineSixteen"
      : ["square", "landscape", "nineSixteen", "threeFour", "fourThree"].includes(rawAspect)
        ? rawAspect
        : "square";
  const quality = ["low", "medium", "high", "auto"].includes(input.quality)
    ? input.quality
    : "high";
  const background = ["auto", "opaque", "transparent"].includes(input.background)
    ? input.background
    : "auto";
  const outputFormat = ["png", "jpeg", "webp"].includes(input.outputFormat)
    ? input.outputFormat
    : "png";
  const moderation = ["auto", "low"].includes(input.moderation) ? input.moderation : "auto";
  const prompt = String(input.requestPrompt || input.prompt || "").trim();
  const model = String(input.model || "gpt-image-2").trim() || "gpt-image-2";
  const referenceImages = normalizeReferenceImages(input.referenceImages);
  const size = GENERATION_SIZE_MAP[resolution]?.[aspect] || GENERATION_SIZE_MAP["1k"].square;

  return {
    model,
    prompt,
    size,
    resolution,
    aspect,
    quality,
    background,
    moderation,
    outputFormat,
    n: 1,
    referenceImages,
    referenceCount: referenceImages.length,
  };
}

function normalizeAssistantReasoningEffort(value) {
  return ["low", "medium", "high"].includes(value) ? value : "medium";
}

function normalizeAssistPlan(input) {
  const rawPlan = input && typeof input === "object" ? input : {};
  const total = Math.max(1, Math.min(20, Number(rawPlan.total) || 1));
  const groups = Array.isArray(rawPlan.groups)
    ? rawPlan.groups
        .filter((group) => group && typeof group === "object")
        .map((group) => ({
          kind: typeof group.kind === "string" ? group.kind : "standard",
          count: Math.max(1, Math.min(20, Number(group.count) || 1)),
        }))
    : [{ kind: "standard", count: total }];

  return {
    total,
    mode: rawPlan.mode === "ecommerce" ? "ecommerce" : "standard",
    groups,
  };
}

function normalizeAssistQueue(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      kind: typeof item.kind === "string" ? item.kind : "standard",
      kindIndex: Math.max(1, Number(item.kindIndex) || index + 1),
      kindCount: Math.max(1, Number(item.kindCount) || 1),
      globalIndex: Math.max(1, Number(item.globalIndex) || index + 1),
      total: Math.max(1, Number(item.total) || input.length || 1),
    }));
}

function buildAssistMessages(payload) {
  const plan = normalizeAssistPlan(payload.plan);
  const queue = normalizeAssistQueue(payload.queue);
  const referenceCount = Math.max(0, Number(payload.referenceCount) || 0);
  const resolution = ["1k", "2k", "4k"].includes(payload.resolution) ? payload.resolution : "1k";
  const aspect = ["square", "landscape", "nineSixteen", "threeFour", "fourThree"].includes(payload.aspect)
    ? payload.aspect
    : "square";
  const generationMode = payload.generationMode === "parallel" ? "parallel" : "queue";
  const prompt = String(payload.prompt || "").trim();
  const systemPrompt = [
    normalizeAssistantSystemPrompt(payload.assistantSystemPrompt),
    "输出必须是严格 JSON，不要 markdown，不要解释，不要代码块。",
    'JSON 格式固定为 {"perImagePrompts":[{"globalIndex":1,"kind":"main","prompt":"..."},...] }。',
  ].join("\n");

  const userPrompt = [
    "请基于以下信息生成多图子提示词：",
    `原始提示词: ${prompt}`,
    `参考图数量: ${referenceCount}`,
    `生成分辨率: ${resolution}`,
    `画幅: ${aspect}`,
    `多图执行模式: ${generationMode}`,
    `计划: ${JSON.stringify(plan)}`,
    `队列: ${JSON.stringify(queue)}`,
    "要求：",
    "1. 每个 prompt 都要可直接交给图片模型，不要再提“第几张图”这类流程说明。",
    "2. 保留原始提示词中的核心商品、风格、材质、颜色和关键卖点。",
    "3. 如果是 main，请突出主图完整展示和高转化构图；如果是 sub，请保证与主图和其他副图有明显差异。",
    "4. 输出数量必须与队列长度一致，globalIndex 必须一一对应。",
  ].join("\n");

  return [
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: userPrompt,
    },
  ];
}

function buildAssistUpstreamRequest(payload, apiKey) {
  const assistantModel = String(payload.assistantModel || "gpt-5.4-mini").trim() || "gpt-5.4-mini";
  const reasoningEffort = normalizeAssistantReasoningEffort(payload.assistantReasoningEffort);
  const endpoint = normalizeChatEndpoint(payload.endpoint);
  const body = {
    model: assistantModel,
    messages: buildAssistMessages(payload),
  };

  if (reasoningEffort) {
    body.reasoning_effort = reasoningEffort;
  }

  return {
    endpoint,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    summary: {
      model: assistantModel,
      reasoningEffort,
      queueLength: Array.isArray(payload.queue) ? payload.queue.length : 0,
    },
  };
}

function buildReverseMessages(payload) {
  const prompt = String(payload.prompt || "").trim();
  const referenceImages = normalizeReferenceImages(payload.referenceImages);
  const systemPrompt = [
    normalizeReversePromptSystemPrompt(payload.reversePromptSystemPrompt),
    "输出必须是严格 JSON，不要 markdown，不要解释，不要代码块。",
    'JSON 结构固定为 {"summary":"","prompt_cn":"","prompt_en":"","negative_prompt":"","style_tags":["..."],"visual_breakdown":{"subject":"","composition":"","camera":"","lighting":"","background":"","material":"","color":"","style":"","mood":""},"uncertain_points":["..."],"variants":[{"title":"","prompt":""}] }。',
    "如果某个字段无法确定，可返回空字符串、空数组或空对象。",
  ].join("\n");

  const userContent = [
    {
      type: "text",
      text: [
        "请根据以下图片反推可直接用于 gpt-image-2 的高质量提示词。",
        prompt ? `补充要求: ${prompt}` : "补充要求: 无，请主要根据图片本身输出。",
      ].join("\n"),
    },
  ];

  referenceImages.forEach((reference) => {
    userContent.push({
      type: "image_url",
      image_url: {
        url: reference.dataUrl,
      },
    });
  });

  return [
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: userContent,
    },
  ];
}

function buildReverseUpstreamRequest(payload, apiKey) {
  const assistantModel = String(payload.assistantModel || "gpt-5.4-mini").trim() || "gpt-5.4-mini";
  const reasoningEffort = normalizeAssistantReasoningEffort(payload.assistantReasoningEffort);
  const referenceCount = normalizeReferenceImages(payload.referenceImages).length;
  const endpoint = normalizeChatEndpoint(payload.endpoint);
  const body = {
    model: assistantModel,
    messages: buildReverseMessages(payload),
  };

  if (reasoningEffort) {
    body.reasoning_effort = reasoningEffort;
  }

  return {
    endpoint,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    summary: {
      model: assistantModel,
      reasoningEffort,
      referenceCount,
    },
  };
}

function extractCompletionText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (typeof part?.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("")
      .trim();
    if (text) {
      return text;
    }
  }

  if (typeof data?.choices?.[0]?.text === "string" && data.choices[0].text.trim()) {
    return data.choices[0].text.trim();
  }

  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  return "";
}

function extractJsonObject(rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    return null;
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidateTexts = [text];
  if (fencedMatch?.[1]) {
    candidateTexts.unshift(fencedMatch[1].trim());
  }

  for (const candidate of candidateTexts) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      const firstBrace = candidate.indexOf("{");
      const lastBrace = candidate.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        try {
          return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
        } catch (nestedError) {
          continue;
        }
      }
    }
  }

  return null;
}

function hasUsableReversePromptResult(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return false;
  }

  const promptCn = String(
    parsed.prompt_cn || parsed.promptCn || parsed.main_prompt_cn || parsed.mainPromptCn || ""
  ).trim();
  const promptEn = String(
    parsed.prompt_en || parsed.promptEn || parsed.main_prompt_en || parsed.mainPromptEn || ""
  ).trim();
  const variants = Array.isArray(parsed.variants) ? parsed.variants : [];

  if (promptCn || promptEn) {
    return true;
  }

  return variants.some((entry) =>
    Boolean(
      String(entry?.prompt || entry?.text || entry?.prompt_cn || entry?.promptCn || "").trim()
    )
  );
}

function normalizeAssistPromptList(parsed, queue) {
  const items = Array.isArray(parsed?.perImagePrompts)
    ? parsed.perImagePrompts
    : Array.isArray(parsed?.items)
      ? parsed.items
      : null;

  if (!items) {
    return null;
  }

  return queue.map((queueItem, index) => {
    const matchedByIndex = items.find(
      (entry) => Number(entry?.globalIndex) === Number(queueItem.globalIndex)
    );
    const entry = matchedByIndex || items[index];
    const prompt = String(entry?.prompt || entry?.requestPrompt || "").trim();

    if (!prompt) {
      return null;
    }

    return {
      globalIndex: queueItem.globalIndex,
      kind: queueItem.kind,
      prompt,
    };
  });
}

function dataUrlToBlob(reference) {
  const match = String(reference.dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error(`Invalid reference image data URL: ${reference.name}`);
  }

  const mimeType = match[1] || reference.type || "image/png";
  const base64Payload = match[2];
  const buffer = Buffer.from(base64Payload, "base64");

  return new Blob([buffer], {
    type: mimeType,
  });
}

function buildUpstreamRequest(payload, apiKey) {
  const params = buildRequestParams(payload);
  const mode = params.referenceCount > 0 ? "edit" : "generate";
  const endpoint = normalizeEndpoint(payload.endpoint, mode);

  if (mode === "edit") {
    const form = new FormData();
    form.append("model", params.model);
    form.append("prompt", params.prompt);
    form.append("size", params.size);
    form.append("quality", params.quality);
    form.append("background", params.background);
    form.append("moderation", params.moderation);
    form.append("output_format", params.outputFormat);
    form.append("n", String(params.n));

    params.referenceImages.forEach((reference) => {
      form.append("image[]", dataUrlToBlob(reference), reference.name);
    });

    return {
      endpoint,
      mode,
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
      },
      summary: {
        model: params.model,
        prompt: truncateText(params.prompt, 240),
        size: params.size,
        quality: params.quality,
        background: params.background,
        moderation: params.moderation,
        output_format: params.outputFormat,
        referenceCount: params.referenceCount,
      },
    };
  }

  const body = {
    model: params.model,
    prompt: params.prompt,
    size: params.size,
    quality: params.quality,
    background: params.background,
    moderation: params.moderation,
    output_format: params.outputFormat,
    n: params.n,
  };

  return {
    endpoint,
    mode,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    summary: {
      ...body,
      referenceCount: 0,
    },
  };
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let totalBytes = 0;

    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_JSON_BODY_SIZE) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }

      raw += chunk;
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
}

async function handleGenerate(req, res) {
  let endpoint = null;
  let requestSummary = null;
  let requestMode = "generate";

  try {
    const payload = await parseJsonBody(req);
    const apiKey = String(payload.apiKey || "").trim();
    const prompt = String(payload.requestPrompt || payload.prompt || "").trim();

    if (!apiKey) {
      sendJson(res, 400, { error: "缺少 API 密钥。" });
      return;
    }

    if (!prompt) {
      sendJson(res, 400, { error: "请输入提示词。" });
      return;
    }

    const upstreamRequest = buildUpstreamRequest(payload, apiKey);
    endpoint = upstreamRequest.endpoint;
    requestSummary = upstreamRequest.summary;
    requestMode = upstreamRequest.mode;
    const startedAt = Date.now();

    const upstream = await fetch(endpoint, upstreamRequest.init);
    const rawText = await upstream.text();
    let data;

    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (error) {
      data = { raw: rawText };
    }

    if (!upstream.ok) {
      const errorMessage =
        data?.error?.message ||
        data?.message ||
        `上游接口返回 ${upstream.status} ${upstream.statusText}`;

      sendJson(res, upstream.status, {
        error: errorMessage,
        details: data,
        diagnostics: {
          kind: "upstream_http_error",
          endpoint,
          mode: requestMode,
          status: upstream.status,
          statusText: upstream.statusText,
          model: requestSummary?.model || null,
          size: requestSummary?.size || null,
          referenceCount: requestSummary?.referenceCount || 0,
          upstreamSummary: summarizeUpstreamDetails(data),
        },
      });
      return;
    }

    const firstImage = data?.data?.[0];
    const b64 = firstImage?.b64_json;

    if (!b64) {
      sendJson(res, 502, {
        error: "接口已返回成功，但响应中没有图片数据。",
        details: data,
        diagnostics: {
          kind: "missing_image_data",
          endpoint,
          mode: requestMode,
          status: upstream.status,
          statusText: upstream.statusText,
          model: requestSummary?.model || null,
          size: requestSummary?.size || null,
          referenceCount: requestSummary?.referenceCount || 0,
          upstreamSummary: summarizeUpstreamDetails(data),
        },
      });
      return;
    }

    sendJson(res, 200, {
      created: data.created || null,
      imageBase64: b64,
      revisedPrompt: firstImage?.revised_prompt || null,
      usage: data.usage || null,
      latencyMs: Date.now() - startedAt,
      request: {
        endpoint,
        mode: requestMode,
        body: requestSummary,
      },
    });
  } catch (error) {
    sendJson(res, 502, {
      error: error.message || "服务内部错误。",
      diagnostics: {
        kind: "upstream_fetch_failed",
        endpoint,
        mode: requestMode,
        model: requestSummary?.model || null,
        size: requestSummary?.size || null,
        referenceCount: requestSummary?.referenceCount || 0,
        errorName: error?.name || null,
        errorMessage: error?.message || null,
        causeCode: error?.cause?.code || null,
        causeMessage: error?.cause?.message || null,
      },
    });
  }
}

async function handleAssistPrompt(req, res) {
  let endpoint = null;
  let requestSummary = null;

  try {
    const payload = await parseJsonBody(req);
    const apiKey = String(payload.apiKey || "").trim();
    const prompt = String(payload.prompt || "").trim();
    const queue = normalizeAssistQueue(payload.queue);

    if (!apiKey) {
      sendJson(res, 400, { error: "缺少 API 密钥。" });
      return;
    }

    if (!prompt) {
      sendJson(res, 400, { error: "请输入提示词。" });
      return;
    }

    if (!queue.length) {
      sendJson(res, 400, { error: "缺少多图队列信息。" });
      return;
    }

    const upstreamRequest = buildAssistUpstreamRequest(payload, apiKey);
    endpoint = upstreamRequest.endpoint;
    requestSummary = upstreamRequest.summary;
    const startedAt = Date.now();

    const upstream = await fetch(endpoint, upstreamRequest.init);
    const rawText = await upstream.text();
    let data;

    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (error) {
      data = { raw: rawText };
    }

    if (!upstream.ok) {
      const errorMessage =
        data?.error?.message ||
        data?.message ||
        `上游接口返回 ${upstream.status} ${upstream.statusText}`;

      sendJson(res, upstream.status, {
        error: errorMessage,
        details: data,
        diagnostics: {
          kind: "assistant_prompt_failed",
          endpoint,
          status: upstream.status,
          statusText: upstream.statusText,
          assistantModel: requestSummary?.model || null,
          reasoningEffort: requestSummary?.reasoningEffort || null,
          upstreamSummary: summarizeUpstreamDetails(data),
        },
      });
      return;
    }

    const content = extractCompletionText(data);
    const parsed = extractJsonObject(content);
    const normalizedPrompts = normalizeAssistPromptList(parsed, queue);

    if (!normalizedPrompts || normalizedPrompts.some((item) => !item)) {
      sendJson(res, 502, {
        error: "辅助模型返回内容无法解析为有效的多图提示词。",
        diagnostics: {
          kind: "assistant_prompt_failed",
          endpoint,
          assistantModel: requestSummary?.model || null,
          reasoningEffort: requestSummary?.reasoningEffort || null,
          upstreamSummary: truncateText(content || rawText, 500),
        },
      });
      return;
    }

    sendJson(res, 200, {
      optimized: true,
      assistantModel: requestSummary?.model || null,
      reasoningEffort: requestSummary?.reasoningEffort || null,
      perImagePrompts: normalizedPrompts,
      latencyMs: Date.now() - startedAt,
      usage: data?.usage || null,
    });
  } catch (error) {
    sendJson(res, 502, {
      error: error.message || "辅助提示词优化失败。",
      diagnostics: {
        kind: "assistant_prompt_failed",
        endpoint,
        assistantModel: requestSummary?.model || null,
        reasoningEffort: requestSummary?.reasoningEffort || null,
        errorName: error?.name || null,
        errorMessage: error?.message || null,
        causeCode: error?.cause?.code || null,
        causeMessage: error?.cause?.message || null,
      },
    });
  }
}

async function handleReversePrompt(req, res) {
  let endpoint = null;
  let requestSummary = null;

  try {
    const payload = await parseJsonBody(req);
    const apiKey = String(payload.apiKey || "").trim();
    const referenceImages = normalizeReferenceImages(payload.referenceImages);

    if (!apiKey) {
      sendJson(res, 400, { error: "缺少 API 密钥。" });
      return;
    }

    if (!referenceImages.length) {
      sendJson(res, 400, { error: "请至少提供 1 张待反推图片。" });
      return;
    }

    const upstreamRequest = buildReverseUpstreamRequest(
      {
        ...payload,
        referenceImages,
      },
      apiKey
    );
    endpoint = upstreamRequest.endpoint;
    requestSummary = upstreamRequest.summary;
    const startedAt = Date.now();

    const upstream = await fetch(endpoint, upstreamRequest.init);
    const rawText = await upstream.text();
    let data;

    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (error) {
      data = { raw: rawText };
    }

    if (!upstream.ok) {
      const errorMessage =
        data?.error?.message ||
        data?.message ||
        `上游接口返回 ${upstream.status} ${upstream.statusText}`;

      sendJson(res, upstream.status, {
        error: errorMessage,
        details: data,
        diagnostics: {
          kind: "reverse_prompt_failed",
          endpoint,
          status: upstream.status,
          statusText: upstream.statusText,
          assistantModel: requestSummary?.model || null,
          reasoningEffort: requestSummary?.reasoningEffort || null,
          referenceCount: requestSummary?.referenceCount || 0,
          upstreamSummary: summarizeUpstreamDetails(data),
        },
      });
      return;
    }

    const content = extractCompletionText(data);
    const parsed = extractJsonObject(content);

    if (!parsed || !hasUsableReversePromptResult(parsed)) {
      sendJson(res, 502, {
        error: "反推模型返回内容无法解析为有效的提示词结果。",
        diagnostics: {
          kind: "reverse_prompt_failed",
          endpoint,
          assistantModel: requestSummary?.model || null,
          reasoningEffort: requestSummary?.reasoningEffort || null,
          referenceCount: requestSummary?.referenceCount || 0,
          upstreamSummary: truncateText(content || rawText, 500),
        },
      });
      return;
    }

    sendJson(res, 200, {
      assistantModel: requestSummary?.model || null,
      reasoningEffort: requestSummary?.reasoningEffort || null,
      imageCount: requestSummary?.referenceCount || referenceImages.length,
      result: parsed,
      latencyMs: Date.now() - startedAt,
      usage: data?.usage || null,
    });
  } catch (error) {
    sendJson(res, 502, {
      error: error.message || "图片反推提示词失败。",
      diagnostics: {
        kind: "reverse_prompt_failed",
        endpoint,
        assistantModel: requestSummary?.model || null,
        reasoningEffort: requestSummary?.reasoningEffort || null,
        referenceCount: requestSummary?.referenceCount || 0,
        errorName: error?.name || null,
        errorMessage: error?.message || null,
        causeCode: error?.cause?.code || null,
        causeMessage: error?.cause?.message || null,
      },
    });
  }
}

function safeJoinPublic(urlPath) {
  const pathname = urlPath === "/" ? "/index.html" : urlPath;
  return path.resolve(PUBLIC_DIR, `.${pathname}`);
}

function handleStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const filePath = safeJoinPublic(requestUrl.pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendJson(res, 404, { error: "Not found" });
        return;
      }

      sendJson(res, 500, { error: "Failed to read file" });
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Content-Length": buffer.length,
      "Cache-Control": [".html", ".js", ".css"].includes(ext) ? "no-cache" : "public, max-age=3600",
    });
    res.end(buffer);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      message: "studio-ready",
      time: new Date().toISOString(),
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/generate") {
    handleGenerate(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/assist-prompt") {
    handleAssistPrompt(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/reverse-prompt") {
    handleReversePrompt(req, res);
    return;
  }

  if (req.method === "GET") {
    handleStatic(req, res);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
});

server.listen(PORT, HOST, () => {
  console.log(`GPT Image Studio running at http://${HOST}:${PORT}`);
});
