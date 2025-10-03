import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV, boolCV, optionalCV, principalCV, buffCV } from "@stacks/transactions";

const ERR_UNAUTHORIZED = 100;
const ERR_DUPLICATE_HASH = 101;
const ERR_ITEM_NOT_FOUND = 102;
const ERR_INVALID_HASH = 103;
const ERR_INVALID_TYPE = 104;
const ERR_INVALID_WEIGHT = 105;
const ERR_INVALID_DESCRIPTION = 106;
const ERR_INVALID_SERIAL = 107;
const ERR_INVALID_MANUFACTURER = 108;
const ERR_INVALID_STATUS = 109;
const ERR_INVALID_OWNER = 110;
const ERR_TRANSFER_FAILED = 111;
const ERR_BURN_FAILED = 112;
const ERR_UPDATE_FAILED = 113;
const ERR_FEE_TRANSFER_FAILED = 114;
const ERR_INVALID_FEE = 115;
const ERR_ADMIN_ONLY = 116;
const ERR_STATUS_CHANGE_INVALID = 117;
const ERR_ALREADY_REGISTERED = 118;
const ERR_NOT_OWNER = 119;
const ERR_CONTRACT_NOT_SET = 120;

interface WasteItem {
  owner: string;
  itemHash: Uint8Array;
  itemType: string;
  weight: number;
  hazardous: boolean;
  createdAt: number;
  description: string;
  serialNumber: string | null;
  manufacturer: string | null;
  status: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class WasteItemRegistryMock {
  state: {
    itemCounter: number;
    contractAdmin: string;
    registrationFee: number;
    wasteItems: Map<number, WasteItem>;
    itemByHash: Map<string, number>;
  } = {
    itemCounter: 0,
    contractAdmin: "ST1ADMIN",
    registrationFee: 100,
    wasteItems: new Map(),
    itemByHash: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  authorizedUsers: Set<string> = new Set(["ST1TEST", "ST2TEST"]);
  stxTransfers: Array<{ amount: number; from: string; to: string }> = [];
  nftOwners: Map<number, string> = new Map();

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      itemCounter: 0,
      contractAdmin: "ST1ADMIN",
      registrationFee: 100,
      wasteItems: new Map(),
      itemByHash: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.authorizedUsers = new Set(["ST1TEST", "ST2TEST"]);
    this.stxTransfers = [];
    this.nftOwners = new Map();
  }

  isAuthorized(principal: string): Result<boolean> {
    return { ok: true, value: this.authorizedUsers.has(principal) };
  }

  setRegistrationFee(newFee: number): Result<boolean> {
    if (this.caller !== this.state.contractAdmin) return { ok: false, value: ERR_ADMIN_ONLY };
    if (newFee < 0) return { ok: false, value: ERR_INVALID_FEE };
    this.state.registrationFee = newFee;
    return { ok: true, value: true };
  }

  setContractAdmin(newAdmin: string): Result<boolean> {
    if (this.caller !== this.state.contractAdmin) return { ok: false, value: ERR_ADMIN_ONLY };
    if (newAdmin === "SP000000000000000000002Q6VF78") return { ok: false, value: ERR_INVALID_OWNER };
    this.state.contractAdmin = newAdmin;
    return { ok: true, value: true };
  }

  registerItem(
    itemHash: Uint8Array,
    itemType: string,
    weight: number,
    hazardous: boolean,
    description: string,
    serial: string | null,
    manufacturer: string | null
  ): Result<number> {
    if (!this.isAuthorized(this.caller).value) return { ok: false, value: ERR_UNAUTHORIZED };
    if (itemHash.length !== 32) return { ok: false, value: ERR_INVALID_HASH };
    if (itemType.length === 0 || itemType.length > 50) return { ok: false, value: ERR_INVALID_TYPE };
    if (weight <= 0) return { ok: false, value: ERR_INVALID_WEIGHT };
    if (description.length > 256) return { ok: false, value: ERR_INVALID_DESCRIPTION };
    if (serial && serial.length > 100) return { ok: false, value: ERR_INVALID_SERIAL };
    const hashKey = Buffer.from(itemHash).toString('hex');
    if (this.state.itemByHash.has(hashKey)) return { ok: false, value: ERR_DUPLICATE_HASH };
    this.stxTransfers.push({ amount: this.state.registrationFee, from: this.caller, to: this.state.contractAdmin });
    const itemId = this.state.itemCounter + 1;
    const item: WasteItem = {
      owner: this.caller,
      itemHash,
      itemType,
      weight,
      hazardous,
      createdAt: this.blockHeight,
      description,
      serialNumber: serial,
      manufacturer,
      status: "registered",
    };
    this.state.wasteItems.set(itemId, item);
    this.state.itemByHash.set(hashKey, itemId);
    this.nftOwners.set(itemId, this.caller);
    this.state.itemCounter = itemId;
    return { ok: true, value: itemId };
  }

  getItemDetails(itemId: number): WasteItem | null {
    return this.state.wasteItems.get(itemId) || null;
  }

  getItemByHash(itemHash: Uint8Array): WasteItem | null {
    const hashKey = Buffer.from(itemHash).toString('hex');
    const itemId = this.state.itemByHash.get(hashKey);
    return itemId !== undefined ? this.getItemDetails(itemId) : null;
  }

  getOwner(itemId: number): Result<string | null> {
    return { ok: true, value: this.nftOwners.get(itemId) || null };
  }

  transferItem(itemId: number, newOwner: string): Result<boolean> {
    const currentOwner = this.nftOwners.get(itemId);
    if (!currentOwner) return { ok: false, value: ERR_ITEM_NOT_FOUND };
    if (this.caller !== currentOwner) return { ok: false, value: ERR_NOT_OWNER };
    if (!this.isAuthorized(newOwner).value) return { ok: false, value: ERR_UNAUTHORIZED };
    if (newOwner === "SP000000000000000000002Q6VF78") return { ok: false, value: ERR_INVALID_OWNER };
    this.nftOwners.set(itemId, newOwner);
    const item = this.state.wasteItems.get(itemId);
    if (item) {
      this.state.wasteItems.set(itemId, { ...item, owner: newOwner });
    }
    return { ok: true, value: true };
  }

  updateItemStatus(itemId: number, newStatus: string): Result<boolean> {
    const item = this.state.wasteItems.get(itemId);
    if (!item) return { ok: false, value: ERR_ITEM_NOT_FOUND };
    const currentOwner = this.nftOwners.get(itemId);
    if (this.caller !== currentOwner) return { ok: false, value: ERR_NOT_OWNER };
    if (!["registered", "collected", "transported", "processed", "disposed"].includes(newStatus)) {
      return { ok: false, value: ERR_INVALID_STATUS };
    }
    this.state.wasteItems.set(itemId, { ...item, status: newStatus });
    return { ok: true, value: true };
  }

  burnItem(itemId: number): Result<boolean> {
    if (this.caller !== this.state.contractAdmin) return { ok: false, value: ERR_ADMIN_ONLY };
    const currentOwner = this.nftOwners.get(itemId);
    if (!currentOwner) return { ok: false, value: ERR_ITEM_NOT_FOUND };
    const item = this.state.wasteItems.get(itemId);
    if (item) {
      const hashKey = Buffer.from(item.itemHash).toString('hex');
      this.state.itemByHash.delete(hashKey);
    }
    this.state.wasteItems.delete(itemId);
    this.nftOwners.delete(itemId);
    return { ok: true, value: true };
  }

  getItemCount(): Result<number> {
    return { ok: true, value: this.state.itemCounter };
  }

  getRegistrationFee(): Result<number> {
    return { ok: true, value: this.state.registrationFee };
  }

  isItemRegistered(itemHash: Uint8Array): Result<boolean> {
    const hashKey = Buffer.from(itemHash).toString('hex');
    return { ok: true, value: this.state.itemByHash.has(hashKey) };
  }
}

describe("WasteItemRegistry", () => {
  let contract: WasteItemRegistryMock;

  beforeEach(() => {
    contract = new WasteItemRegistryMock();
    contract.reset();
    contract.caller = "ST1ADMIN";
    contract.setContractAdmin("ST1ADMIN");
    contract.caller = "ST1TEST";
  });

  it("registers an item successfully", () => {
    const hash = new Uint8Array(32).fill(1);
    const result = contract.registerItem(hash, "laptop", 2000, true, "Old laptop", "SN123", "STMANU");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1);
    const item = contract.getItemDetails(1);
    expect(item?.itemType).toBe("laptop");
    expect(item?.weight).toBe(2000);
    expect(item?.hazardous).toBe(true);
    expect(item?.description).toBe("Old laptop");
    expect(item?.serialNumber).toBe("SN123");
    expect(item?.manufacturer).toBe("STMANU");
    expect(item?.status).toBe("registered");
    expect(contract.stxTransfers).toEqual([{ amount: 100, from: "ST1TEST", to: "ST1ADMIN" }]);
  });

  it("rejects duplicate hash", () => {
    const hash = new Uint8Array(32).fill(1);
    contract.registerItem(hash, "laptop", 2000, true, "Old laptop", "SN123", "STMANU");
    const result = contract.registerItem(hash, "phone", 500, false, "Old phone", null, null);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_DUPLICATE_HASH);
  });

  it("rejects unauthorized caller", () => {
    contract.caller = "ST3FAKE";
    contract.authorizedUsers.delete("ST3FAKE");
    const hash = new Uint8Array(32).fill(2);
    const result = contract.registerItem(hash, "laptop", 2000, true, "Old laptop", "SN123", "STMANU");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });

  it("rejects invalid hash length", () => {
    const hash = new Uint8Array(31).fill(3);
    const result = contract.registerItem(hash, "laptop", 2000, true, "Old laptop", "SN123", "STMANU");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_HASH);
  });

  it("rejects invalid type", () => {
    const hash = new Uint8Array(32).fill(4);
    const result = contract.registerItem(hash, "", 2000, true, "Old laptop", "SN123", "STMANU");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TYPE);
  });

  it("transfers item successfully", () => {
    const hash = new Uint8Array(32).fill(5);
    contract.registerItem(hash, "laptop", 2000, true, "Old laptop", "SN123", "STMANU");
    const result = contract.transferItem(1, "ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const owner = contract.getOwner(1);
    expect(owner.value).toBe("ST2TEST");
    const item = contract.getItemDetails(1);
    expect(item?.owner).toBe("ST2TEST");
  });

  it("rejects transfer by non-owner", () => {
    const hash = new Uint8Array(32).fill(6);
    contract.registerItem(hash, "laptop", 2000, true, "Old laptop", "SN123", "STMANU");
    contract.caller = "ST2TEST";
    const result = contract.transferItem(1, "ST3TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_OWNER);
  });

  it("updates status successfully", () => {
    const hash = new Uint8Array(32).fill(7);
    contract.registerItem(hash, "laptop", 2000, true, "Old laptop", "SN123", "STMANU");
    const result = contract.updateItemStatus(1, "collected");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const item = contract.getItemDetails(1);
    expect(item?.status).toBe("collected");
  });

  it("rejects invalid status", () => {
    const hash = new Uint8Array(32).fill(8);
    contract.registerItem(hash, "laptop", 2000, true, "Old laptop", "SN123", "STMANU");
    const result = contract.updateItemStatus(1, "invalid");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_STATUS);
  });

  it("burns item successfully", () => {
    const hash = new Uint8Array(32).fill(9);
    contract.registerItem(hash, "laptop", 2000, true, "Old laptop", "SN123", "STMANU");
    contract.caller = "ST1ADMIN";
    const result = contract.burnItem(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getItemDetails(1)).toBeNull();
    expect(contract.getOwner(1).value).toBeNull();
  });

  it("rejects burn by non-admin", () => {
    const hash = new Uint8Array(32).fill(10);
    contract.registerItem(hash, "laptop", 2000, true, "Old laptop", "SN123", "STMANU");
    const result = contract.burnItem(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ADMIN_ONLY);
  });

  it("gets item by hash", () => {
    const hash = new Uint8Array(32).fill(11);
    contract.registerItem(hash, "laptop", 2000, true, "Old laptop", "SN123", "STMANU");
    const item = contract.getItemByHash(hash);
    expect(item?.itemType).toBe("laptop");
  });

  it("checks item registered", () => {
    const hash = new Uint8Array(32).fill(12);
    contract.registerItem(hash, "laptop", 2000, true, "Old laptop", "SN123", "STMANU");
    const result = contract.isItemRegistered(hash);
    expect(result.value).toBe(true);
  });

  it("sets registration fee", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setRegistrationFee(200);
    expect(result.ok).toBe(true);
    expect(contract.getRegistrationFee().value).toBe(200);
  });

  it("sets contract admin", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setContractAdmin("STNEWADMIN");
    expect(result.ok).toBe(true);
    expect(contract.state.contractAdmin).toBe("STNEWADMIN");
  });
});