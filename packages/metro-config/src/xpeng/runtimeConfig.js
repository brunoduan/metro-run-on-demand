/**
 * Copyright (c) XPENG, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 * @format
 */

'use strict';

const fs = require('fs');
const path = require('path');

const indexFilename = "index";
const idsFilename = "ids";
let splitRamBundle;
let bundleOutput;
let filenameIds;

function getIdsFilename() {
    if (bundleOutput == undefined) {
      return undefined;
    }
    
    filenameIds = path.dirname(bundleOutput);

    return path.join(filenameIds, idsFilename);
  }

function getIndexFilename() {
  if (getIdsFilename() == undefined) {
    return undefined;
  }
    
  return path.join(getIdsFilename(), indexFilename);
}

function setOutputPath(output) {
  if (output == undefined) {
    return;
  }

  bundleOutput = path.resolve(output);
}

function getOutputPath() {
  return bundleOutput;
}

function setSplitRamBundle(split) {
  splitRamBundle = split;
}

function getSplitRamBundle() {
  return splitRamBundle;
}

function getLastBundleId() {
  let lastBundleId = 0;
  let idsFilename = getIdsFilename();

  try {
    if (!fs.existsSync(idsFilename)) {
      fs.mkdirSync(idsFilename, {recursive: true});
    }
      
    let data = fs.readFileSync(getIndexFilename());
    if (data !== undefined) {
      lastBundleId = Number.parseInt(data);
    }
  } catch (e) {}

  return lastBundleId;
}

function resetModuleIds() {
  const filename = getIndexFilename();
  if (filename == undefined) {
    return;
  }

  try {
    fs.unlinkSync(filename);
  } catch (e) {}
}

module.exports = {
  setOutputPath: setOutputPath,
  getOutputPath: getOutputPath,
  setSplitRamBundle: setSplitRamBundle,
  getSplitRamBundle: getSplitRamBundle,
  resetModuleIds: resetModuleIds,
  getIdsFilename: getIdsFilename,
  getIndexFilename: getIndexFilename,
  getLastBundleId: getLastBundleId,
  indexShortFilename: indexFilename
}
