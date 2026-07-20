import { getCardDestination, moveCard, type Column } from "@/lib/kanban";

const baseColumns: Column[] = [
  { id: "col-a", title: "A", cardIds: ["card-1", "card-2"] },
  { id: "col-b", title: "B", cardIds: ["card-3"] },
];

describe("moveCard", () => {
  it("reorders cards in the same column", () => {
    const result = moveCard(baseColumns, "card-2", "card-1");
    expect(result[0].cardIds).toEqual(["card-2", "card-1"]);
  });

  it("moves cards to another column", () => {
    const result = moveCard(baseColumns, "card-2", "card-3");
    expect(result[0].cardIds).toEqual(["card-1"]);
    expect(result[1].cardIds).toEqual(["card-2", "card-3"]);
  });

  it("drops cards to the end of a column", () => {
    const result = moveCard(baseColumns, "card-1", "col-b");
    expect(result[0].cardIds).toEqual(["card-2"]);
    expect(result[1].cardIds).toEqual(["card-3", "card-1"]);
  });
});

describe("getCardDestination", () => {
  it("returns a same-column reorder position", () => {
    expect(getCardDestination(baseColumns, "card-2", "card-1")).toEqual({
      columnId: "col-a",
      position: 0,
    });
  });

  it("returns a cross-column position", () => {
    expect(getCardDestination(baseColumns, "card-2", "card-3")).toEqual({
      columnId: "col-b",
      position: 0,
    });
  });

  it("returns null when a drop does not change order", () => {
    expect(getCardDestination(baseColumns, "card-1", "card-1")).toBeNull();
  });
});
