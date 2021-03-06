/**
 * Created by godsong on 16/10/12.
 */
const path = require('path');
const inquirer = require('inquirer');
const fs = require('fs');
const chalk = require('chalk');
const _ = require('underscore');
const utils = require('./index');
const logger = utils.logger;

const _resolveConfigDef = (source, configDef, config, key) => {
  if (configDef.type) {
    if (config[key] === undefined) {
      throw new Error('Config:[' + key + '] must have a value!');
    }
    return replacer[configDef.type](source, configDef.key, config[key]);
  }
  else {
    return configDef.handler(source, config[key], replacer);
  }
};

const Platforms = {
  ios: 'ios',
  android: 'android'
};

const replacer = {
  plist (source, key, value) {
    const r = new RegExp('(<key>' + key + '</key>\\s*<string>)[^<>]*?</string>', 'g');
    if ((key === 'WXEntryBundleURL' || key === 'WXSocketConnectionURL')) {
      if (key === 'WXEntryBundleURL') {
        value = path.join('bundlejs', value)
      }
      return source.replace(/<\/dict>\n?\W*?<\/plist>\W*?\n?\W*?\n?$/i, match => `  <key>${key}</key>\n  <string>${value}</string>\n${match}`);
    }
    return source.replace(r, '$1' + value + '</string>');
  },
  xmlTag (source, key, value, tagName = 'string') {
    const r = new RegExp(`<${tagName} name="${key}" .*>[^<]+?</${tagName}>`, 'g');
    return source.replace(r, `<${tagName} name="${key}">${value}</${tagName}>`);
  },
  xmlAttr (source, key, value, tagName = 'string') {
    const r = new RegExp(`<${tagName} name="${key}"\\s* value="[^"]*?"\\s*/>`, 'g');
    return source.replace(r, `<${tagName} name="${key}" value="${value}"/>`);
  },
  regexp (source, regexp, value) {
    return source.replace(regexp, function (m, a, b) {
      return a + value + (b || '');
    });
  }
};

class PlatformConfig {
  constructor (properties, rootPath, platform, configs) {
    this.rootPath = rootPath;
    this.platform = platform;
    this.configs = configs;
    if (properties instanceof PlatformConfigResolver) {
      const map = {};
      this.properties = [];
      for (const key in properties.def) {
        for (const propName in properties.def[key]) {
          if (!map[propName]) {
            this.properties.push({
              name: propName,
              desc: properties.def[key].desc || 'enter your ' + propName + ':'
            });
            map[propName] = true;
          }
        }
      }
    }
    else {
      this.properties = properties.split(',').map(prop => {
        const splits = prop.split('|');
        return {
          name: splits[0],
          desc: splits[1] || 'enter your ' + splits[0] + ':'
        };
      });
    }
  }

  getConfig () {
    return new Promise((resolve, reject) => {
      let config = {};
      let defaultConfig = {};
      const questions = [];
      const answers = {};
      const configPath = path.join(this.rootPath, `${this.platform}.config.json`);
      const defaultConfigPath = path.join(this.rootPath, '.wx', `config.json`);
      if (fs.existsSync(defaultConfigPath)) {
        const wxConfig = require(defaultConfigPath);
        defaultConfig = wxConfig && wxConfig[this.platform] || {};
      }
      if (fs.existsSync(configPath)) {
        config = require(configPath);
      }
      config = _.extend(this.configs || {}, defaultConfig, config);
      logger.log('============Build Config============');
      this.properties.forEach(function (prop) {
        if (config[prop.name] !== undefined) {
          answers[prop.name] = config[prop.name];
          logger.log(chalk.green(`${utils.fill(prop.name, 12)} : ${answers[prop.name]}`));
        }
        else {
          questions.push({
            type: 'input',
            message: prop.desc,
            name: prop.name
          });
        }
      });
      if (questions.length > 0) {
        inquirer.prompt(questions)
          .then((answers) => {
            Object.assign(config, answers);
            fs.writeFileSync(path.join(this.rootPath, `${this.platform}.config.json`), JSON.stringify(config, null, 4));
            resolve(config);
          });
      }
      else {
        logger.info(`If you want to change build config.please modify ${this.platform}.config.json`);
        resolve(config);
      }
    });
  }
}

class PlatformConfigResolver {
  constructor (def) {
    this.def = def;
  }
  resolve (config, basePath) {
    basePath = basePath || process.cwd();
    for (const d in this.def) {
      if (this.def.hasOwnProperty(d)) {
        const targetPath = path.join(basePath, d);
        let source = fs.readFileSync(targetPath).toString();
        for (const key in this.def[d]) {
          if (this.def[d].hasOwnProperty(key)) {
            const configDef = this.def[d][key];
            if (_.isArray(configDef)) {
              configDef.forEach((def) => {
                source = _resolveConfigDef(source, def, config, key);
              });
            }
            else {
              source = _resolveConfigDef(source, configDef, config, key);
            }
          }
        }
        fs.writeFileSync(targetPath, source);
      }
    }
  }
}

const AndroidConfigResolver = new PlatformConfigResolver({
  'build.gradle': {
    AppId: {
      type: 'regexp',
      key: /(applicationId ")[^"]*(")/g
    }
  },
  'app/src/main/res/values/strings.xml': {
    AppName: {
      type: 'xmlTag',
      key: 'app_name'
    },
    SplashText: {
      type: 'xmlTag',
      key: 'dummy_content'
    }
  },
  'app/src/main/res/xml/app_config.xml': {
    WeexBundle: {
      handler: function (source, value, replacer) {
        if (/https?/.test(value)) {
          source = replacer.xmlAttr(source, 'launch_locally', 'false', 'preference');
          return replacer.xmlAttr(source, 'launch_url', value, 'preference');
        }
        else {
          source = replacer.xmlAttr(source, 'launch_locally', 'true', 'preference');
          const name = value.replace(/\.(we|vue)$/, '.js');
          return replacer.xmlAttr(source, 'local_url', 'file://assets/dist/' + name, 'preference');
        }
      }
    }
  }
});

const iOSConfigResolver = new PlatformConfigResolver({
  'WeexDemo/WeexDemo-Info.plist': {
    AppName: {
      type: 'plist',
      key: 'CFBundleDisplayName'
    },
    Version: {
      type: 'plist',
      key: 'CFBundleShortVersionString'
    },
    BuildVersion: {
      type: 'plist',
      key: 'CFBundleVersion'
    },
    AppId: {
      type: 'plist',
      key: 'CFBundleIdentifier'
    },
    WeexBundle: {
      type: 'plist',
      key: 'WXEntryBundleURL'
    },
    Ws: {
      type: 'plist',
      key: 'WXSocketConnectionURL'
    }
  },
  'WeexDemo.xcodeproj/project.pbxproj': {
    CodeSign: [{
      type: 'regexp',
      key: /("?CODE_SIGN_IDENTITY(?:\[sdk=iphoneos\*])?"?\s*=\s*").*?(")/g
    }, {
      type: 'plist',
      key: 'CODE_SIGN_IDENTITY(\\[sdk=iphoneos\\*])?'
    }
    ],
    Profile: [
      {
        type: 'regexp',
        key: /(PROVISIONING_PROFILE\s*=\s*")[^"]*?(")/g
      },
      {
        type: 'plist',
        key: 'PROVISIONING_PROFILE'
      }
    ]
  }

});

module.exports = {
  Platforms,
  PlatformConfig,
  PlatformConfigResolver,
  AndroidConfigResolver,
  iOSConfigResolver
};
