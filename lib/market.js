const HEADER_ALIASES = {
  category: ["구분", "분류", "카테고리"],
  name: ["품목", "상품", "상품명", "품명"],
  unit: ["단위", "판매단위"],
  price: ["가격", "판매가"],
  stock: ["재고", "남은수량", "남은 수량", "재고상태"],
  note: ["특이사항", "설명", "비고"],
  updatedAt: ["갱신시각", "수정시각", "업데이트", "최종수정"]
};

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field.trim());
      field = "";
    } else if (char === "\n") {
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function headerIndex(headers, aliases) {
  const normalized = headers.map((value) => value.replace(/\s/g, ""));
  return aliases.map((value) => value.replace(/\s/g, "")).map((value) => normalized.indexOf(value)).find((index) => index >= 0) ?? -1;
}

export function rowsToProducts(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const indexes = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, headerIndex(headers, aliases)]));
  if (indexes.name < 0) throw new Error("시트에 '품목' 열이 없습니다.");

  return rows.slice(1).map((row) => Object.fromEntries(Object.entries(indexes).map(([key, index]) => [key, index >= 0 ? (row[index] || "") : ""]))).filter((item) => item.name);
}

export function isSoldOut(stock = "") {
  const value = stock.replace(/\s/g, "").toLowerCase();
  return value === "0" || value.startsWith("0개") || value.startsWith("0마리") || value.startsWith("0박스") || /품절|완판|소진/.test(value);
}

function remainingNumber(stock = "") {
  const match = stock.replace(/,/g, "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

export function findProducts(question, products) {
  const compact = question.replace(/\s/g, "").toLowerCase();
  const exact = products.filter((item) => compact.includes(item.name.replace(/\s/g, "").toLowerCase()));
  if (exact.length) return exact;
  return products.filter((item) => item.category && compact.includes(item.category.replace(/\s/g, "").toLowerCase()));
}

function describe(item) {
  const stockText = item.stock || "재고 확인 필요";
  if (isSoldOut(stockText)) return `${item.name}은(는) 오늘 준비된 수량이 모두 소진됐어요.`;
  const unit = item.unit ? ` ${item.unit}` : "";
  const price = item.price ? ` ${item.price}` : " 가격 확인 필요";
  const count = remainingNumber(stockText);
  const hurry = (count !== null && count <= 3) || /마감|임박|소량/.test(stockText) ? " 수량이 얼마 남지 않았어요." : "";
  return `${item.name}${unit} ${price}, 재고 ${stockText}입니다.${hurry}`;
}

export function deterministicReply(question, products, storeName = "매장") {
  if (!products.length) return "현재 상품표를 불러오지 못했어요. 잠시 후 다시 문의해 주세요.";
  const matched = findProducts(question, products);
  if (matched.length) return matched.slice(0, 4).map(describe).join("\n").slice(0, 950);

  if (/뭐|무엇|목록|상품들|메뉴|종류/.test(question)) {
    const available = products.filter((item) => !isSoldOut(item.stock)).slice(0, 6);
    if (!available.length) return "현재 판매 가능한 상품이 등록되어 있지 않아요. 매장에 문의해 주세요.";
    return `현재 ${available.map((item) => `${item.name}${item.price ? `(${item.price})` : ""}`).join(", ")} 판매 중이에요.\n재고는 매장 판매로 달라질 수 있습니다.`.slice(0, 950);
  }

  if (/안녕|하이|처음|시작/.test(question)) return `안녕하세요, ${storeName}입니다! 상품명이나 “오늘 과일 뭐 있어?”처럼 물어보세요.`;
  return "현재 등록된 정보로는 해당 품목을 확인하기 어려워요. 정확한 상품명을 다시 입력해 주세요.";
}

export function productsForPrompt(products) {
  return products.slice(0, 100).map((item) => ({
    구분: item.category,
    품목: item.name,
    단위: item.unit,
    가격: item.price,
    재고: item.stock,
    특이사항: item.note,
    갱신시각: item.updatedAt
  }));
}
