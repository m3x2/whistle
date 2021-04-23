const LEAF_DELIMITER = '__LEAF__';

const parse = ({ url, id }) => {
  try {
    const { origin, pathname, search } = new URL(url);
    let result = [origin, ...pathname.slice(1).split('/')];

    if (pathname.indexOf(LEAF_DELIMITER) === -1 && id) {
      let leaf = result.pop();
      leaf += LEAF_DELIMITER + id;
      result = [...result, leaf];
    }

    return {
      queue: result,
      search: search.slice(0, 200),
    };
  } catch (error) {
    return null;
  }
};

const prune = (url) => {
  if (!url || !RegExp(LEAF_DELIMITER).test(url)) {
    return url;
  }
  return url.split(LEAF_DELIMITER)[0];
};

const dfs = ({
  node,
  callback,
}) => {
  let stack = [node];

  while (stack.length > 0) {
    const item = stack.shift();
    if (!item) {
      continue;
    }

    if (item.childrenMap && item.childrenMap.size > 0) {
      stack.unshift(...item.children);
    }

    callback(item);
  }
};

class Tree {
  // contains all tree node
  root = {};
  // contains all unfolded node
  list = [];
  // contains all filtered node
  filterList = [];
  // map prefix to request list index
  map = new Map();

  // find target node
  // or closest parent
  search({ url, id }) {
    const result = parse({ url, id });
    if (!result) {
      return;
    }

    const {
      queue,
      search,
    } = result;

    let node = this.root;
    let depth = -1;
    let highlight = queue[0];

    // node: parent node
    // queue: url path queue
    while (node && queue.length) {
      const item = queue[0];
      if (!item) {
        break;
      }

      if (!node.childrenMap || node.childrenMap.size <= 0) {
        break;
      }

      const next = node.childrenMap.get(item);
      if (typeof next !== 'number') {
        break;
      }

      let temp = node.children[next];
      if (!temp) {
        break;
      }

      node = temp;
      queue.shift();
      ++depth;

      if (this.list.indexOf(node.id) > -1) {
        highlight = node.id;
      }
    }

    return {
      node,
      queue,
      depth,
      search,
      highlight,
    };
  }

  insert({ url, id, index }) {
    const result = this.search({ url, id });
    if (!result) {
      return;
    }

    let {
      node,
      queue,
      depth,
      search,
      highlight,
    } = result;

    let child = null;

    while (node && queue.length) {
      const item = queue.shift();
      if (!item) {
        continue;
      }

      if (!node.childrenMap) {
        node.childrenMap = new Map();
        node.children = [];
      }

      let prefix = item;
      if (node.id) {
        prefix = `${node.id}/${item}`;
      }
      const isLeaf = queue.length < 1;

      let next = node.childrenMap.get(item);

      let temp = {
        value: item, // for tree
        id: prefix, // for map & list
        parent: node,
      };

      if (!isLeaf) {
        temp.children = [];
        temp.childrenMap = new Map();
      }

      next = node.childrenMap.size;
      node.children.push(temp);
      node.childrenMap.set(item, next);

      this.map.set(prefix, {
        index: isLeaf ? index : -1, // request list index
        search, // for render
        value: prune(item), // for render
        depth: ++depth,
        fold: true,
      });

      node = node.children[next];

      if (child === null) {
        child = node;
      }
    }

    return this.flush({
      parent: highlight,
      child,
    });
  }

  // find the closest unfolded parent
  // update list if needed
  flush({
    parent,
    child,
  }) {
    if (!child) {
      return parent;
    }

    let start = this.list.indexOf(parent);

    if (child.parent.id === parent) {
      const p = this.map.get(parent);
      if (p && !p.fold) {
        const end = this.list.length;

        while (++start < end) {
          if (!this.list[start].startsWith(parent)) {
            break;
          }
        }

        if (start < end) {
          this.list.splice(start, 0, child.id);
        } else {
          this.list.push(child.id);
        }

        return child.id;
      }
    }

    if (start === -1) {
      this.list.push(parent);
    }

    return parent;
  }

  // DFS delete
  // 1. down: node + children
  // 2. up: node + parent(s)
  delete({ url, id }) {
    if (!url) {
      return;
    }

    const result = this.search({ url, id });
    if (!result) {
      return;
    }

    const callback = (node) => {
      const { parent, value, id } = node;

      if (!parent) {
        return;
      }

      // remove node
      let index = parent.childrenMap.get(value);
      // replace node with placeholder
      // because children map uses original index
      parent.children[index] = null;
      parent.childrenMap.delete(value);

      // remove map
      this.map.delete(id);

      // remove list
      index = this.list.indexOf(id);
      if (index > -1) {
        this.list.splice(index, 1);
      }
    };

    let { node } = result;

    dfs({
      node,
      callback,
    });

    while (node && node.parent) {
      node = node.parent;
      if (node.childrenMap && node.childrenMap.size >= 1) {
        break;
      }
      callback(node);
    }
  }

  clear() {
    this.root = {};
    this.list = [];
    this.map.clear();
    return this.list;
  }

  toggle(url, recursive = false) {
    // invalid url
    if (!url || !this.map.has(url)) {
      return;
    }

    // url is invisible
    let index = this.list.indexOf(url);
    if (index === -1) {
      return;
    }

    // find target node
    const result = this.search({ url });
    if (!result) {
      return;
    }

    // next state
    const item = this.map.get(url);
    const next = !item.fold;
    this.map.set(url, {
      ...item,
      fold: next,
    });

    let { node } = result;
    let queue = [];
    let delta = 0;

    const callback = (node) => {
      const { id } = node;
      // not including target
      if (id === url) {
        return;
      }

      // exist node in list
      if (this.list.indexOf(id) > -1) {
        ++delta;
      }

      // recursive or node.parent = unfold
      let valid = recursive;
      if (!valid) {
        if (node.parent.id) {
          const config = this.map.get(node.parent.id);
          if (config && !config.fold) {
            valid = true;
          }
        }
      }
      if (valid) {
        queue.push(id);
      }

      // set next state
      if (recursive) {
        const item = this.map.get(id);
        this.map.set(id, {
          ...item,
          fold: next,
        });
      }
    };

    dfs({
      node,
      callback,
    });

    // fold
    let options = [index + 1, delta];
    // unfold
    if (!next) {
      options = options.concat(queue);
    }
    this.list.splice(...options);
  }
}

module.exports = Tree;
