import test from "node:test";
import assert from "node:assert/strict";
import { deterministicReply, isSoldOut, parseCsv, rowsToProducts } from "../lib/market.js";

const csv = `구분,품목,단위,가격,재고,특이사항\n수산,산낙지,1마리,"6,000원",품절,오늘 완판\n청과,샤인머스캣,1박스,16000원,2박스,"달고, 신선함"`;
const products = rowsToProducts(parseCsv(csv));

test("quoted commas are parsed", () => {
  assert.equal(products[0].price, "6,000원");
  assert.equal(products[1].note, "달고, 신선함");
});

test("sold out product is never described as available", () => {
  assert.equal(isSoldOut(products[0].stock), true);
  assert.match(deterministicReply("산낙지 있어요?", products), /소진/);
});

test("low stock adds urgency", () => {
  assert.match(deterministicReply("샤인머스캣 얼마예요?", products), /얼마 남지/);
});

test("unknown item does not invent availability", () => {
  assert.match(deterministicReply("복숭아 있어요?", products), /확인하기 어려워요/);
});
