/**
 * Copyright (c) XPENG, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 * @format
 */
"use strict";

const MAGIC_UNBUNDLE_FILE_HEADER = require("metro/src/shared/output/RamBundle/magic-number");

const buildSourcemapWithMetadata = require("metro/src/shared/output/RamBundle/buildSourcemapWithMetadata");

const fs = require("fs");

const relativizeSourceMapInline = require("metro/src/lib/relativizeSourceMap");

const writeSourceMap = require("metro/src/shared/output/RamBundle/write-sourcemap");

const _require = require("metro/src/shared/output/RamBundle/util"),
  joinModules = _require.joinModules;

const SIZEOF_UINT32 = 4;
/**
 * Saves all JS modules of an app as a single file, separated with null bytes.
 * The file begins with an offset table that contains module ids and their
 * lengths/offsets.
 * The module id for the startup code (prelude, polyfills etc.) is the
 * empty string.
 */

function saveAsIndexedFile(bundle, options, log) {
  const bundleOutput = options.bundleOutput,
    encoding = options.bundleEncoding,
    sourcemapOutput = options.sourcemapOutput,
    sourcemapSourcesRoot = options.sourcemapSourcesRoot;
  log("start");
  const startupModules = bundle.startupModules,
    lazyModules = bundle.lazyModules,
    groups = bundle.groups;
  log("finish");
  const moduleGroups = createModuleGroups(groups, lazyModules);
  const startupCode = joinModules(startupModules);
  log("Writing unbundle output to:", bundleOutput);
  const writeUnbundle = writeBuffers(
    fs.createWriteStream(bundleOutput),
    buildTableAndContents(startupCode, lazyModules, moduleGroups, encoding)
  ).then(() => log("Done writing unbundle output"));

  if (options.indexedRamBundle && options.splitRamBundle) {
    const _writeFile = require('metro/src/shared/output/writeFile');
    const _path = require('path');
    let runtimeConfig = require("metro-config/src/xpeng/runtimeConfig"),
        lastBundleId = runtimeConfig.getLastBundleId(),
        filenameIds = runtimeConfig.getIdsFilename(),
        indexFilename = runtimeConfig.getIndexFilename();
    ++lastBundleId;
    _writeFile(indexFilename, lastBundleId, encoding).then(() => {
      log('Down writing the bundle id: ' + indexFilename);
    });

    const curBundleIdFilename = _path.join(filenameIds, lastBundleId.toString());
    const allModules = startupModules.concat(lazyModules);
    const moduleIds = allModules.map(m => {
      //console.log("id: " + m.id + " type: " + m.type + " path: " + m.sourcePath);
      const pair = {};
      pair.path = m.sourcePath;
      pair.id = m.id;
      return pair;
    });
    _writeFile(curBundleIdFilename, JSON.stringify(moduleIds), encoding).then(() => {
      log('Down writing the ids: ' + curBundleIdFilename);
    });
  }

  if (sourcemapOutput) {
    const sourceMap = buildSourcemapWithMetadata({
      startupModules: startupModules.concat(),
      lazyModules: lazyModules.concat(),
      moduleGroups,
      fixWrapperOffset: true
    });

    if (sourcemapSourcesRoot !== undefined) {
      relativizeSourceMapInline(sourceMap, sourcemapSourcesRoot);
    }

    const wroteSourceMap = writeSourceMap(
      sourcemapOutput,
      JSON.stringify(sourceMap),
      log
    );
    return Promise.all([writeUnbundle, wroteSourceMap]);
  } else {
    return writeUnbundle;
  }
}
/* global Buffer: true */

const fileHeader = Buffer.alloc(4);
fileHeader.writeUInt32LE(MAGIC_UNBUNDLE_FILE_HEADER, 0);
const nullByteBuffer = Buffer.alloc(1).fill(0);

function writeBuffers(stream, buffers) {
  buffers.forEach(buffer => stream.write(buffer));
  return new Promise((resolve, reject) => {
    stream.on("error", reject);
    stream.on("finish", () => resolve());
    stream.end();
  });
}

function nullTerminatedBuffer(contents, encoding) {
  return Buffer.concat([Buffer.from(contents, encoding), nullByteBuffer]);
}

function moduleToBuffer(id, code, encoding) {
  return {
    id,
    buffer: nullTerminatedBuffer(code, encoding)
  };
}

function entryOffset(n) {
  // n * 2: each entry consists of two uint32s
  // 3: minimal id + num_entries + startup_code_len
  return (3 + n * 2) * SIZEOF_UINT32;
}

function buildModuleTable(startupCode, moduleBuffers, moduleGroups) {
  // table format:
  // - minimal module id
  // - num_entries:      uint_32  number of entries
  // - startup_code_len: uint_32  length of the startup section
  // - entries:          entry...
  //
  // entry:
  //  - module_offset:   uint_32  offset into the modules blob
  //  - module_length:   uint_32  length of the module code in bytes
  const moduleIds = Array.from(moduleGroups.modulesById.keys());
  const minId = moduleIds.reduce((min, id) => Math.min(min, id));
  const maxId = moduleIds.reduce((max, id) => Math.max(max, id));
  const numEntries = maxId - minId + 1;
  const table = Buffer.alloc(entryOffset(numEntries)).fill(0); // num_entries

  // minimal module id
  table.writeUInt32LE(minId, 0);
  // num_entries
  table.writeUInt32LE(numEntries, SIZEOF_UINT32);
  // startup_code_len
  table.writeUInt32LE(startupCode.length, 2 * SIZEOF_UINT32);

  // entries
  let codeOffset = startupCode.length;
  moduleBuffers.forEach(_ref => {
    let id = _ref.id,
      buffer = _ref.buffer;
    const group = moduleGroups.groups.get(id);
    const idsInGroup = group ? [id].concat(Array.from(group)) : [id];
    idsInGroup.forEach(moduleId => {
      const offset = entryOffset(moduleId - minId); // module_offset

      table.writeUInt32LE(codeOffset, offset); // module_length

      table.writeUInt32LE(buffer.length, offset + SIZEOF_UINT32);
    });
    codeOffset += buffer.length;
  });
  return table;
}

function groupCode(rootCode, moduleGroup, modulesById) {
  if (!moduleGroup || !moduleGroup.size) {
    return rootCode;
  }

  const code = [rootCode];

  for (const id of moduleGroup) {
    code.push(
      (
        modulesById.get(id) || {
          code: ""
        }
      ).code
    );
  }

  return code.join("\n");
}

function buildModuleBuffers(modules, moduleGroups, encoding) {
  return modules
    .filter(m => !moduleGroups.modulesInGroups.has(m.id))
    .map(_ref2 => {
      let id = _ref2.id,
        code = _ref2.code;
      return moduleToBuffer(
        id,
        groupCode(code, moduleGroups.groups.get(id), moduleGroups.modulesById),
        encoding
      );
    });
}

function buildTableAndContents(startupCode, modules, moduleGroups, encoding) {
  // file contents layout:
  // - magic number      char[4]  0xE5 0xD1 0x0B 0xFB (0xFB0BD1E5 uint32 LE)
  // - offset table      table    see `buildModuleTables`
  // - code blob         char[]   null-terminated code strings, starting with
  //                              the startup code
  const startupCodeBuffer = nullTerminatedBuffer(startupCode, encoding);
  const moduleBuffers = buildModuleBuffers(modules, moduleGroups, encoding);
  const table = buildModuleTable(
    startupCodeBuffer,
    moduleBuffers,
    moduleGroups
  );
  /* $FlowFixMe(>=0.70.0 site=react_native_fb) This comment suppresses an
   * error found when Flow v0.70 was deployed. To see the error delete this
   * comment and run Flow. */

  return [fileHeader, table, startupCodeBuffer].concat(
    moduleBuffers.map(_ref3 => {
      let buffer = _ref3.buffer;
      return buffer;
    })
  );
}

function createModuleGroups(groups, modules) {
  return {
    groups,
    modulesById: new Map(modules.map(m => [m.id, m])),
    modulesInGroups: new Set(concat(groups.values()))
  };
}

function* concat(iterators) {
  for (const it of iterators) {
    yield* it;
  }
}

exports.save = saveAsIndexedFile;
exports.buildTableAndContents = buildTableAndContents;
exports.createModuleGroups = createModuleGroups;
