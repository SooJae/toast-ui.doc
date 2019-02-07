const path = require('path');
const fs = require('fs-extra');
const mkdirp = require('mkdirp');
const Prism = require('prismjs');
const helper = require('./apiDataFactoryHelper');

const pwd = process.cwd();
const pkg = require(path.resolve(pwd, 'package.json'));
const config = require(path.resolve(pwd, 'tuidoc.config.json'));

const GITHUB_LINK = makeGithubLink();
const DATA_FILES_PATH = path.resolve(__dirname, `../src/data/apiPage`);

/**
 * Make github link for using in file link
 * @returns {string} github's permanent link base
 */
function makeGithubLink() {
  const {fileLink} = config;

  let baseRepo, customRef;

  if (fileLink) {
    const {
      repository,
      ref
    } = fileLink;

    baseRepo = repository;
    customRef = ref;
  } else {
    const {
      repository,
      version
    } = pkg;

    baseRepo = (repository.url || repository).replace('.git', '');
    customRef = `v${version}`;
  }

  return `${baseRepo}/blob/${customRef}/`;
}

/**
 * Make prefix of type
 * @param {Object} data - type information
 * @returns {string} prefix string
 */
function makeTypePrefix(data) {
  const {type} = data;

  let prefix = '';

  if (type === 'NullableType') {
    prefix = '?';
  } else if (type === 'NonNullableType') {
    prefix = '!';
  } else if (type === 'RestType') {
    prefix = '...';
  } else if (type === 'AllLiteral') {
    prefix = '*';
  }

  return prefix;
}

/**
 * Make name of type including expression
 * @param {Object} data - type information
 * @returns {Array.<String>} name list
 */
function makeExpressionNames(data) {
  const {
    elements,
    expression,
    name
  } = data;

  let names;

  if (elements) {
    names = elements.map(item => {
      let itemName;

      if (item.type === 'TypeApplication') {
        itemName = makeTypeApplicationName(item.applications, item.expression);
      } else {
        itemName = item.name;
      }

      return itemName;
    });
  } else if (expression) {
    names = [expression.name || ''];
  } else {
    names = [name || ''];
  }

  return names;
}

/**
 * Make name of type-application type (ex: {Array.<string>})
 * @param {Object} items - type list
 * @param {Object} expression - expression data
 * @returns {string} name
 */
function makeTypeApplicationName(items, expression) {
  let joinedNames = items.map(item => item.name || 'undefined').join(',');

  return `${expression.name}.${joinedNames}`;
}

/**
 * Make name of union type (ex: {string|number})
 * @param {Object} items - type list
 * @returns {Array.<String>} name list
 */
function makeUnionTypeNames(items) {
  return items.map(item => {
    const {
      expression,
      applications,
      fields,
      name
    } = item;

    if (applications) {
      return makeTypeApplicationName(applications, expression);
    }

    if (fields) {
      return 'Object';
    }

    return name || 'undefined';
  });
}

/**
 * Make data of parameter type
 * @param {object} data - data of type
 * @returns {object} type information
 * @link http://usejsdoc.org/tags-type.html
 */
function makeTypes(data) { // eslint-disable-line complexity
  data = data || '';

  const {
    type,
    name,
    expression,
    elements,
    applications
  } = data;

  let prefix = '';
  let names;

  if (expression) {
    prefix = makeTypePrefix(expression);
    names = makeExpressionNames(expression);
  }

  if (type === 'UnionType') {
    names = makeUnionTypeNames(elements);
  } else if (type === 'TypeApplication') {
    names = [makeTypeApplicationName(applications, expression)];
  } else if (type === 'RecordType') {
    names = ['Object'];
  } else if (type === 'NameExpression') {
    names = [name];
  }

  return {
    prefix,
    names: names || [''],
    isOptional: type === 'OptionalType'
  };
}

/**
 * Make item name
 * @param {string} name - item name
 * @param {string} kind - item kind
 * @param {Array.<Object>} params - list of @param
 * @returns {string} function formatted name
 */
function makeName(name, kind, params) {
  let joinedParams = params.map(param => param.name).join(', ');
  let customName = `${name}(${joinedParams})`;

  if (kind === 'class') {
    customName = `new ${name}(${joinedParams})`;
  } else if (name.indexOf('external:') > -1) {
    name = name.split('external:').pop().split('#').pop();
    customName = `${name}(${joinedParams})`;
  } else if (kind === 'event') {
    customName = name.split('#').pop();
  } else if (kind === 'typedef' || kind === 'namespace') {
    customName = name;
  }

  return customName;
}

/**
 * Make item pid
 * @param {string} name - item name
 * @param {string} kind - item kind
 * @returns {string} replaced pid
 */
function makePid(name, kind) {
  let pid = name;

  if (kind === 'event') {
    pid = `event-${name.split('#').pop()}`;
  }

  return pid;
}

/**
 * Make description
 * @param {object} data - description information
 * @returns {string} description
 */
function makeDescription(data) {
  if (data.children && data.children.length) {
    return data.children[0].children.map(child => {
      const {
        type,
        value,
        url,
        children
      } = child;
      let text = '';

      if (type === 'text') {
        text = value;
      } else if (type === 'link' || type === 'linkReference') {
        text = `<a href="${url}">${children[0].value}</a>`;
      }

      return text.replace(/\n/g, '<br>');
    }).join('');
  }

  return '';
}

/**
 * Make code information
 * @param {object} context - file name of full path
 * @returns {object} code information
 */
function makeCodeInfo(context) {
  const {
    file,
    loc
  } = context;
  const githubPath = file.split(`${pwd}/`).pop();
  const filename = file.split(`/`).pop();
  const lineNum = loc.start.line;

  return {
    filename,
    lineNum,
    linkUrl: `${GITHUB_LINK}${githubPath}`
  };
}

/**
 * Make data via parsing @see
 * @param {Array.<Object>} items - see items
 * @returns {Array.<Object>} view data list
 */
function makeSeeItems(items) {
  let customItems = items.map(item => makeDescription(item));

  customItems.push('');

  return customItems;
}

/**
 * Make data via parsing @augment or @extend
 * @param {Array.<Object>} items - augment items
 * @returns {Array.<Object>} view data list
 */
function makeAugmentItems(items) {
  let customItems = items.map(item => item.name);

  customItems.push('');

  return customItems;
}

/**
 * Make data via parsing @todo
 * @param {Array.<Object>} items - todo items
 * @returns {Array.<Object>} view data
 */
function makeTodoItems(items) {
  let customItems = items.map(item => makeDescription(item));

  customItems.push('');

  return customItems;
}

/**
 * Make data via parsing @param
 * @param {Array.<Object>} items - param items
 * @returns {Array.<Object>} view data list
 */
function makeParams(items) {
  let customParams = items.map(item => {
    const {
      name,
      type,
      description,
      properties
    } = item;
    const defaultValue = item['default'];

    return {
      name: name.split('.').pop(),
      types: makeTypes(type),
      defaultVal: defaultValue,
      description: makeDescription(description || []),
      properties: properties ? makeParams(properties) : null
    };
  });

  customParams.push(helper.getDefaultParam());

  return customParams;
}

/**
 * Make data via parsing @returns
 * @param {Array.<Object>} items - return items
 * @returns {Array.<Object>} view data list
 */
function makeReturnItems(items) {
  const customItems = items.map(item => {
    const {
      type,
      description
    } = item;

    return {
      types: makeTypes(type),
      description: makeDescription(description)
    };
  });

  customItems.push({
    types: {
      prefix: '',
      type: '',
      names: ['']
    },
    description: ''
  });

  return customItems;
}

/**
 * Make data via parsing @example
 * @param {Array.<Object>} items - example items
 * @returns {Array.<Object>} view data list
 */
function makeExampleItems(items) {
  const customItems = items.map(item => {
    const {
      caption,
      description
    } = item;

    return {
      description: caption ? makeDescription(caption) : '',
      code: Prism.highlight(description, Prism.languages.javascript, 'javascript')
    };
  });

  customItems.push({
    description: '',
    code: ''
  });

  return customItems;
}

/**
 * Make data of property item
 * @param {Object} data - data object
 * @param {string} itemType - item type (static or instance)
 * @returns {Object} view data
 */
function makePropertyItem(data, itemType) {
  const {
    override,
    deprecated,
    name,
    type,
    description,
    context,
    sees,
    augments,
    todos,
    examples
  } = data;

  return {
    type: itemType,
    pid: name,
    override: !!override,
    deprecated: !!deprecated,
    name: name,
    types: makeTypes(type),
    description: makeDescription(description),
    codeInfo: makeCodeInfo(context),
    sees: makeSeeItems(sees),
    augments: makeAugmentItems(augments),
    todos: makeTodoItems(todos),
    examples: makeExampleItems(examples)
  };
}

/**
 * Make data of function item
 * @param {Object} data - data object
 * @param {string} itemType - item type (static or instance)
 * @returns {Object} view data
 */
function makeFunctionItem(data, itemType) {
  let {
    override,
    deprecated,
    name,
    type,
    kind,
    description,
    context,
    sees,
    augments,
    todos,
    params,
    properties,
    returns,
    examples
  } = data;

  if (kind === 'event' || kind === 'typedef') {
    params = properties;
  }

  return {
    type: itemType,
    pid: makePid(name, kind),
    override: !!override,
    deprecated: !!deprecated,
    name: makeName(name, kind, params),
    types: makeTypes(type),
    description: makeDescription(description),
    codeInfo: makeCodeInfo(context),
    sees: makeSeeItems(sees),
    augments: makeAugmentItems(augments),
    todos: makeTodoItems(todos),
    params: makeParams(params), // only have in method
    returns: makeReturnItems(returns), // only have in method
    examples: makeExampleItems(examples)
  };
}

/**
 * Make static item list
 * @param {Array.<Object>} items - static item list
 * @returns {Array.<Object>} view data list
 */
function makeStaticItems(items) {
  return items.map(item => {
    const {kind} = item;

    let custumItem;

    if (kind === 'function') {
      custumItem = makeFunctionItem(item, 'static-function');
    } else {
      custumItem = makePropertyItem(item, 'static-property');
    }

    return custumItem;
  });
}

/**
 * Make instance item list
 * @param {Array.<Object>} items - istance item list
 * @returns {Array.<Object>} view data list
 */
function makeInstanceItems(items) {
  const functionItems = [];

  items.forEach(item => {
    if (item.kind === 'function') {
      functionItems.push(makeFunctionItem(item, 'instance-function'));
    }
  });

  return functionItems;
}

/**
 * Make data to content list
 * @param {string} pid - id of item
 * @param {string} parentPid - id of parent item
 * @param {Object} item - content data
 * @returns {Object} customizing content data
 */
function makeContentData(pid, parentPid, item) {
  const {members} = item;
  const overview = makeFunctionItem(item, 'overview');
  const staticMethods = makeStaticItems(members['static']);
  const instanceMethods = makeInstanceItems(members.instance);
  const items = [];

  items.push(overview);

  return {
    pid,
    parentPid,
    title: parentPid.charAt(0).toUpperCase() + parentPid.slice(1),
    items: items.concat(staticMethods).concat(instanceMethods)
  };
}

/**
 * Make json file to using in api page
 * @param {object} data - data to make file
 */
function makeApiPageDataFile(data) {
  mkdirp(DATA_FILES_PATH, err => {
    if (err) {
      throw err;
    }

    fs.writeFileSync(`${DATA_FILES_PATH}/${data.pid}.json`, JSON.stringify(data, null, 2));
  });
}

/**
 * Make member item of content
 * @param {Object} data - original doc-data
 * @returns {Object} custom item object
 */
function makeMemberItem(data) {
  const {
    scope,
    kind
  } = data;
  const type = scope === 'instance' ? 'instance' : 'static';

  let item;

  if (kind === 'event') {
    item = makeFunctionItem(data, `event`);
  } else if (kind === 'typedef') {
    item = makeFunctionItem(data, `typedef`);
  } else if (kind === 'function') {
    item = makeFunctionItem(data, `${type}-function`);
  } else {
    item = makePropertyItem(data, `${type}-property`);
  }

  return item;
}

module.exports = {
  makePropertyItem,
  makeFunctionItem,
  makeContentData,
  makeMemberItem,
  makeInstanceItems,
  makeStaticItems,
  makeApiPageDataFile
};
