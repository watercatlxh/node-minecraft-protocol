'use strict';

const nbt = require('prismarine-nbt');
const UUID = require('uuid-1345');
const zlib = require('zlib');
const [readVarInt, writeVarInt, sizeOfVarInt] = require('protodef').types.varint;

module.exports = {
  varlong: [readVarLong, writeVarLong, sizeOfVarLong],
  UUID: [readUUID, writeUUID, 16],
  compressedNbt: [readCompressedNbt, writeCompressedNbt, sizeOfCompressedNbt],
  restBuffer: [readRestBuffer, writeRestBuffer, sizeOfRestBuffer],
  entityMetadataLoop: [readEntityMetadata, writeEntityMetadata, sizeOfEntityMetadata],
  topBitSetTerminatedArray: [readTopBitSetTerminatedArray, writeTopBitSetTerminatedArray, sizeOfTopBitSetTerminatedArray],
  arrayWithLengthOffset: [readArrayWithLengthOffset, writeArrayWithLengthOffset, sizeOfArrayWithLengthOffset]
};

const PartialReadError = require('protodef').utils.PartialReadError;

function readVarLong(buffer, offset) {
  try {
    return readVarInt(buffer, offset);
  } catch (error) {
    if (error instanceof PartialReadError) {
      console.warn(`Ignoring error: ${error.message}`);
      return null; // 返回null表示忽略该错误包
    } else {
      throw error; // 其他错误继续抛出
    }
  }
}

function writeVarLong(value, buffer, offset) {
  return writeVarInt(value, buffer, offset);
}

function sizeOfVarLong(value) {
  return sizeOfVarInt(value);
}

function readUUID(buffer, offset) {
  try {
    if (offset + 16 > buffer.length) { throw new PartialReadError(); }
    return {
      value: UUID.stringify(buffer.slice(offset, 16 + offset)),
      size: 16
    };
  } catch (error) {
    if (error instanceof PartialReadError) {
      console.warn(`Ignoring error: ${error.message}`);
      return null; // 返回null表示忽略该错误包
    } else {
      throw error; // 其他错误继续抛出
    }
  }
}

function writeUUID(value, buffer, offset) {
  const buf = value.length === 32 ? Buffer.from(value, 'hex') : UUID.parse(value);
  buf.copy(buffer, offset);
  return offset + 16;
}

function sizeOfNbt(value, { tagType } = { tagType: 'nbt' }) {
  return nbt.proto.sizeOf(value, tagType);
}

function readCompressedNbt(buffer, offset) {
  try {
    if (offset + 2 > buffer.length) { throw new PartialReadError(); }
    const length = buffer.readInt16BE(offset);
    if (length === -1) return { size: 2 };
    if (offset + 2 + length > buffer.length) { throw new PartialReadError(); }

    const compressedNbt = buffer.slice(offset + 2, offset + 2 + length);

    const nbtBuffer = zlib.gunzipSync(compressedNbt); // TODO: async

    const results = nbt.proto.read(nbtBuffer, 0, 'nbt');
    return {
      size: length + 2,
      value: results.value
    };
  } catch (error) {
    if (error instanceof PartialReadError) {
      console.warn(`Ignoring error: ${error.message}`);
      return null; // 返回null表示忽略该错误包
    } else {
      throw error; // 其他错误继续抛出
    }
  }
}

function writeCompressedNbt(value, buffer, offset) {
  if (value === undefined) {
    buffer.writeInt16BE(-1, offset);
    return offset + 2;
  }
  const nbtBuffer = Buffer.alloc(sizeOfNbt(value));
  nbt.proto.write(value, nbtBuffer, 0, 'nbt');

  const compressedNbt = zlib.gzipSync(nbtBuffer); // TODO: async
  compressedNbt.writeUInt8(0, 9); // clear the OS field to match MC

  buffer.writeInt16BE(compressedNbt.length, offset);
  compressedNbt.copy(buffer, offset + 2);
  return offset + 2 + compressedNbt.length;
}

function sizeOfCompressedNbt(value) {
  if (value === undefined) { return 2; }

  const nbtBuffer = Buffer.alloc(sizeOfNbt(value, { tagType: 'nbt' }));
  nbt.proto.write(value, nbtBuffer, 0, 'nbt');

  const compressedNbt = zlib.gzipSync(nbtBuffer); // TODO: async

  return 2 + compressedNbt.length;
}

function readRestBuffer(buffer, offset) {
  return {
    value: buffer.slice(offset),
    size: buffer.length - offset
  };
}

function writeRestBuffer(value, buffer, offset) {
  value.copy(buffer, offset);
  return offset + value.length;
}

function sizeOfRestBuffer(value) {
  return value.length;
}

function readEntityMetadata(buffer, offset, { type, endVal }) {
  try {
    let cursor = offset;
    const metadata = [];
    let item;
    while (true) {
      if (offset + 1 > buffer.length) { throw new PartialReadError(); }
      item = buffer.readUInt8(cursor);
      if (item === endVal) {
        return {
          value: metadata,
          size: cursor + 1 - offset
        };
      }
      const results = this.read(buffer, cursor, type, {});
      metadata.push(results.value);
      cursor += results.size;
    }
  } catch (error) {
    if (error instanceof PartialReadError) {
      console.warn(`Ignoring error: ${error.message}`);
      return null; // 返回null表示忽略该错误包
    } else {
      throw error; // 其他错误继续抛出
    }
  }
}

function writeEntityMetadata(value, buffer, offset, { type, endVal }) {
  const self = this;
  value.forEach(function (item) {
    offset = self.write(item, buffer, offset, type, {});
  });
  buffer.writeUInt8(endVal, offset);
  return offset + 1;
}

function sizeOfEntityMetadata(value, { type }) {
  let size = 1;
  for (let i = 0; i < value.length; ++i) {
    size += this.sizeOf(value[i], type, {});
  }
  return size;
}

function readTopBitSetTerminatedArray(buffer, offset, { type }) {
  try {
    let cursor = offset;
    const values = [];
    let item;
    while (true) {
      if (offset + 1 > buffer.length) { throw new PartialReadError(); }
      item = buffer.readUInt8(cursor);
      buffer[cursor] = buffer[cursor] & 127; // removes top bit
      const results = this.read(buffer, cursor, type, {});
      values.push(results.value);
      cursor += results.size;
      if ((item & 128) === 0) { // check if top bit is set, if not last value
        return {
          value: values,
          size: cursor - offset
        };
      }
    }
  } catch (error) {
    if (error instanceof PartialReadError) {
      console.warn(`Ignoring error: ${error.message}`);
      return null; // 返回null表示忽略该错误包
    } else {
      throw error; // 其他错误继续抛出
    }
  }
}

function writeTopBitSetTerminatedArray(value, buffer, offset, { type }) {
  const self = this;
  let prevOffset = offset;
  value.forEach(function (item, i) {
    prevOffset = offset;
    offset = self.write(item, buffer, offset, type, {});
    buffer[prevOffset] = i !== value.length - 1 ? (buffer[prevOffset] | 128) : buffer[prevOffset]; // set top bit for all values but last
  });
  return offset;
}

function sizeOfTopBitSetTerminatedArray(value, { type }) {
  let size = 0;
  for (let i = 0; i < value.length; ++i) {
    size += this.sizeOf(value[i], type, {});
  }
  return size;
}

const { getCount, sendCount, calcCount, tryDoc } = require('protodef/src/utils');

function readArrayWithLengthOffset(buffer, offset, typeArgs, rootNode) {
  try {
    const results = {
      value: [],
      size: 0
    };
    let value;
    let { count, size } = getCount.call(this, buffer, offset, typeArgs, rootNode);
    offset += size;
    results.size += size;
    for (let i = 0; i < count + typeArgs.lengthOffset; i++) {
      ({ size, value } = tryDoc(() => this.read(buffer, offset, typeArgs.type, rootNode), i));
      results.size += size;
      offset += size;
      results.value.push(value);
    }
    return results;
  } catch (error) {
    if (error instanceof PartialReadError) {
      console.warn(`Ignoring error: ${error.message}`);
      return null; // 返回null表示忽略该错误包
    } else {
      throw error; // 其他错误继续抛出
    }
  }
}

function writeArrayWithLengthOffset(value, buffer, offset, typeArgs, rootNode) {
  offset = sendCount.call(this, value.length, buffer, offset, typeArgs, rootNode);
  return value.reduce((offset, v, index) => tryDoc(() => this.write(v, buffer, offset, typeArgs.type, rootNode), index), offset);
}

function sizeOfArrayWithLengthOffset(value, typeArgs, rootNode) {
  let size = calcCount.call(this, value.length, typeArgs, rootNode);
  size = value.reduce((size, v, index) => tryDoc(() => size + this.sizeOf(v, typeArgs.type, rootNode), index), size);
  return size + typeArgs;
}