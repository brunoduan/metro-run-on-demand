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
const runtimeConfig = require('metro-config/src/xpeng/runtimeConfig');

function createModuleIdFactory(modulePath) {
  const outputPath = runtimeConfig.getOutputPath();
  const idsFilename = runtimeConfig.getIdsFilename();
  const indexShortFilename = runtimeConfig.indexShortFilename;
  const lastBundleId = runtimeConfig.getLastBundleId();
  let nextId = lastBundleId * 1000;
  const idsCached = new Map();
  let idsSerialized = new Map();

  if (!fs.existsSync(idsFilename)) {
    fs.mkdirSync(idsFilename, {recursive: true});
  }

  fs.readdirSync(idsFilename).forEach(function(filename) {
      if (indexShortFilename == filename) {
        return;
      }

      const nameId = Number.parseInt(filename);
      if (nameId <= lastBundleId) {
        const fullFilename = path.join(idsFilename, filename);
        const content = fs.readFileSync(fullFilename, 'utf8');
        const idsArr = JSON.parse(content) || [];
        if (idsArr.length > 1000) {
          throw new Error('Two many modules for building ' + outputPath)
        }
        idsArr.map(i => idsSerialized.set(i.path, i.id));
      }
  });

  return (modulePath) => {
    let id = idsCached.get(modulePath);
    if (typeof id !== 'number') {
      id = idsSerialized.get(modulePath);
      if (typeof id === 'number') {
        idsCached.set(modulePath, id);
        return id;
      }

      // not found 
      id = ++nextId;
      idsCached.set(modulePath, id);
    }
    return id;
  };
}

module.exports = {
  createModuleIdFactory: createModuleIdFactory
}
