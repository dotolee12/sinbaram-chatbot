import { deterministicReply, parseCsv, productsForPrompt, rowsToProducts } from "../lib/market.js";

const SHEET_TIMEOUT_MS = 1800;
const GEMINI_TIMEOUT_MS = 1800;

function kakaoResponse(text) {
  return {
    version: "2.0",
    template: { outputs: [{ simpleText: { text: String(text || "잠시 후 다시 문의해 주세요.").slice(0, 950) } }] }
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function loadProducts() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error("GOOGLE_SHEET_ID가 설정되지 않았습니다.");
  const gid = process.env.GOOGLE_SHEET_GID || "0";
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
  const response = await fetchWithTimeout(url, { headers: { accept: "text/csv" } }, SHEET_TIMEOUT_MS);
  if (!response.ok) throw new Error(`Google Sheet 응답 오류: ${response.status}`);
  return rowsToProducts(parseCsv(await response.text()));
}

function shouldUseAi(question) {
  return /추천|요리|가성비|뭘 먹|뭐 먹|골라|어울|레시피/.test(question);
}

async function askGemini(question, products) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const prompt = `당신은 동네 시장의 친절한 점원입니다. 아래 JSON 상품표만 근거로 한국어 2~3문장으로 답하세요.
규칙: 품절/0 재고는 추천하지 않습니다. 표에 없는 사실, 입고 예정, 예약 가능 여부를 만들지 않습니다. 가격과 재고는 표기 그대로 말합니다. 마지막에 재고는 매장 판매로 달라질 수 있다고 짧게 알립니다.
상품표: ${JSON.stringify(productsForPrompt(products))}
손님 질문: ${question}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 180 }
    })
  }, GEMINI_TIMEOUT_MS);
  if (!response.ok) throw new Error(`Gemini 응답 오류: ${response.status}`);
  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, service: process.env.STORE_NAME || "시장 챗봇", endpoint: "/api/chat" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const question = String(req.body?.userRequest?.utterance || "안녕하세요").trim().slice(0, 300);
  try {
    const products = await loadProducts();
    let reply = deterministicReply(question, products, process.env.STORE_NAME || "매장");
    if (shouldUseAi(question)) {
      try {
        reply = (await askGemini(question, products)) || reply;
      } catch (error) {
        console.warn("Gemini fallback:", error?.message || error);
      }
    }
    return res.status(200).json(kakaoResponse(reply));
  } catch (error) {
    console.error("Market bot error:", error?.message || error);
    return res.status(200).json(kakaoResponse("가격표를 잠시 불러오지 못했어요. 잠시 후 다시 문의해 주세요."));
  }
}
