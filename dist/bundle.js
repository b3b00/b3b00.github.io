(function () {
  'use strict';

  function noop() { }
  function assign(tar, src) {
      // @ts-ignore
      for (const k in src)
          tar[k] = src[k];
      return tar;
  }
  function run(fn) {
      return fn();
  }
  function blank_object() {
      return Object.create(null);
  }
  function run_all(fns) {
      fns.forEach(run);
  }
  function is_function(thing) {
      return typeof thing === 'function';
  }
  function safe_not_equal(a, b) {
      return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
  }
  function subscribe(store, ...callbacks) {
      if (store == null) {
          return noop;
      }
      const unsub = store.subscribe(...callbacks);
      return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
  }
  function component_subscribe(component, store, callback) {
      component.$$.on_destroy.push(subscribe(store, callback));
  }
  function create_slot(definition, ctx, $$scope, fn) {
      if (definition) {
          const slot_ctx = get_slot_context(definition, ctx, $$scope, fn);
          return definition[0](slot_ctx);
      }
  }
  function get_slot_context(definition, ctx, $$scope, fn) {
      return definition[1] && fn
          ? assign($$scope.ctx.slice(), definition[1](fn(ctx)))
          : $$scope.ctx;
  }
  function get_slot_changes(definition, $$scope, dirty, fn) {
      if (definition[2] && fn) {
          const lets = definition[2](fn(dirty));
          if (typeof $$scope.dirty === 'object') {
              const merged = [];
              const len = Math.max($$scope.dirty.length, lets.length);
              for (let i = 0; i < len; i += 1) {
                  merged[i] = $$scope.dirty[i] | lets[i];
              }
              return merged;
          }
          return $$scope.dirty | lets;
      }
      return $$scope.dirty;
  }
  function exclude_internal_props(props) {
      const result = {};
      for (const k in props)
          if (k[0] !== '$')
              result[k] = props[k];
      return result;
  }
  function action_destroyer(action_result) {
      return action_result && is_function(action_result.destroy) ? action_result.destroy : noop;
  }

  function append(target, node) {
      target.appendChild(node);
  }
  function insert(target, node, anchor) {
      target.insertBefore(node, anchor || null);
  }
  function detach(node) {
      node.parentNode.removeChild(node);
  }
  function element(name) {
      return document.createElement(name);
  }
  function text(data) {
      return document.createTextNode(data);
  }
  function space() {
      return text(' ');
  }
  function empty() {
      return text('');
  }
  function listen(node, event, handler, options) {
      node.addEventListener(event, handler, options);
      return () => node.removeEventListener(event, handler, options);
  }
  function attr(node, attribute, value) {
      if (value == null)
          node.removeAttribute(attribute);
      else if (node.getAttribute(attribute) !== value)
          node.setAttribute(attribute, value);
  }
  function set_attributes(node, attributes) {
      // @ts-ignore
      const descriptors = Object.getOwnPropertyDescriptors(node.__proto__);
      for (const key in attributes) {
          if (attributes[key] == null) {
              node.removeAttribute(key);
          }
          else if (key === 'style') {
              node.style.cssText = attributes[key];
          }
          else if (descriptors[key] && descriptors[key].set) {
              node[key] = attributes[key];
          }
          else {
              attr(node, key, attributes[key]);
          }
      }
  }
  function children(element) {
      return Array.from(element.childNodes);
  }
  function set_data(text, data) {
      data = '' + data;
      if (text.data !== data)
          text.data = data;
  }
  function set_style(node, key, value, important) {
      node.style.setProperty(key, value, important ? 'important' : '');
  }
  function custom_event(type, detail) {
      const e = document.createEvent('CustomEvent');
      e.initCustomEvent(type, false, false, detail);
      return e;
  }

  let current_component;
  function set_current_component(component) {
      current_component = component;
  }
  function get_current_component() {
      if (!current_component)
          throw new Error(`Function called outside component initialization`);
      return current_component;
  }
  function onMount(fn) {
      get_current_component().$$.on_mount.push(fn);
  }
  function onDestroy(fn) {
      get_current_component().$$.on_destroy.push(fn);
  }
  function createEventDispatcher() {
      const component = get_current_component();
      return (type, detail) => {
          const callbacks = component.$$.callbacks[type];
          if (callbacks) {
              // TODO are there situations where events could be dispatched
              // in a server (non-DOM) environment?
              const event = custom_event(type, detail);
              callbacks.slice().forEach(fn => {
                  fn.call(component, event);
              });
          }
      };
  }
  function setContext(key, context) {
      get_current_component().$$.context.set(key, context);
  }
  function getContext(key) {
      return get_current_component().$$.context.get(key);
  }
  // TODO figure out if we still want to support
  // shorthand events, or if we want to implement
  // a real bubbling mechanism
  function bubble(component, event) {
      const callbacks = component.$$.callbacks[event.type];
      if (callbacks) {
          callbacks.slice().forEach(fn => fn(event));
      }
  }

  const dirty_components = [];
  const binding_callbacks = [];
  const render_callbacks = [];
  const flush_callbacks = [];
  const resolved_promise = Promise.resolve();
  let update_scheduled = false;
  function schedule_update() {
      if (!update_scheduled) {
          update_scheduled = true;
          resolved_promise.then(flush);
      }
  }
  function add_render_callback(fn) {
      render_callbacks.push(fn);
  }
  function add_flush_callback(fn) {
      flush_callbacks.push(fn);
  }
  const seen_callbacks = new Set();
  function flush() {
      do {
          // first, call beforeUpdate functions
          // and update components
          while (dirty_components.length) {
              const component = dirty_components.shift();
              set_current_component(component);
              update(component.$$);
          }
          while (binding_callbacks.length)
              binding_callbacks.pop()();
          // then, once components are updated, call
          // afterUpdate functions. This may cause
          // subsequent updates...
          for (let i = 0; i < render_callbacks.length; i += 1) {
              const callback = render_callbacks[i];
              if (!seen_callbacks.has(callback)) {
                  // ...so guard against infinite loops
                  seen_callbacks.add(callback);
                  callback();
              }
          }
          render_callbacks.length = 0;
      } while (dirty_components.length);
      while (flush_callbacks.length) {
          flush_callbacks.pop()();
      }
      update_scheduled = false;
      seen_callbacks.clear();
  }
  function update($$) {
      if ($$.fragment !== null) {
          $$.update();
          run_all($$.before_update);
          const dirty = $$.dirty;
          $$.dirty = [-1];
          $$.fragment && $$.fragment.p($$.ctx, dirty);
          $$.after_update.forEach(add_render_callback);
      }
  }
  const outroing = new Set();
  let outros;
  function group_outros() {
      outros = {
          r: 0,
          c: [],
          p: outros // parent group
      };
  }
  function check_outros() {
      if (!outros.r) {
          run_all(outros.c);
      }
      outros = outros.p;
  }
  function transition_in(block, local) {
      if (block && block.i) {
          outroing.delete(block);
          block.i(local);
      }
  }
  function transition_out(block, local, detach, callback) {
      if (block && block.o) {
          if (outroing.has(block))
              return;
          outroing.add(block);
          outros.c.push(() => {
              outroing.delete(block);
              if (callback) {
                  if (detach)
                      block.d(1);
                  callback();
              }
          });
          block.o(local);
      }
  }

  function get_spread_update(levels, updates) {
      const update = {};
      const to_null_out = {};
      const accounted_for = { $$scope: 1 };
      let i = levels.length;
      while (i--) {
          const o = levels[i];
          const n = updates[i];
          if (n) {
              for (const key in o) {
                  if (!(key in n))
                      to_null_out[key] = 1;
              }
              for (const key in n) {
                  if (!accounted_for[key]) {
                      update[key] = n[key];
                      accounted_for[key] = 1;
                  }
              }
              levels[i] = n;
          }
          else {
              for (const key in o) {
                  accounted_for[key] = 1;
              }
          }
      }
      for (const key in to_null_out) {
          if (!(key in update))
              update[key] = undefined;
      }
      return update;
  }
  function get_spread_object(spread_props) {
      return typeof spread_props === 'object' && spread_props !== null ? spread_props : {};
  }

  function bind(component, name, callback) {
      const index = component.$$.props[name];
      if (index !== undefined) {
          component.$$.bound[index] = callback;
          callback(component.$$.ctx[index]);
      }
  }
  function create_component(block) {
      block && block.c();
  }
  function mount_component(component, target, anchor) {
      const { fragment, on_mount, on_destroy, after_update } = component.$$;
      fragment && fragment.m(target, anchor);
      // onMount happens before the initial afterUpdate
      add_render_callback(() => {
          const new_on_destroy = on_mount.map(run).filter(is_function);
          if (on_destroy) {
              on_destroy.push(...new_on_destroy);
          }
          else {
              // Edge case - component was destroyed immediately,
              // most likely as a result of a binding initialising
              run_all(new_on_destroy);
          }
          component.$$.on_mount = [];
      });
      after_update.forEach(add_render_callback);
  }
  function destroy_component(component, detaching) {
      const $$ = component.$$;
      if ($$.fragment !== null) {
          run_all($$.on_destroy);
          $$.fragment && $$.fragment.d(detaching);
          // TODO null out other refs, including component.$$ (but need to
          // preserve final state?)
          $$.on_destroy = $$.fragment = null;
          $$.ctx = [];
      }
  }
  function make_dirty(component, i) {
      if (component.$$.dirty[0] === -1) {
          dirty_components.push(component);
          schedule_update();
          component.$$.dirty.fill(0);
      }
      component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
  }
  function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
      const parent_component = current_component;
      set_current_component(component);
      const prop_values = options.props || {};
      const $$ = component.$$ = {
          fragment: null,
          ctx: null,
          // state
          props,
          update: noop,
          not_equal,
          bound: blank_object(),
          // lifecycle
          on_mount: [],
          on_destroy: [],
          before_update: [],
          after_update: [],
          context: new Map(parent_component ? parent_component.$$.context : []),
          // everything else
          callbacks: blank_object(),
          dirty
      };
      let ready = false;
      $$.ctx = instance
          ? instance(component, prop_values, (i, ret, ...rest) => {
              const value = rest.length ? rest[0] : ret;
              if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                  if ($$.bound[i])
                      $$.bound[i](value);
                  if (ready)
                      make_dirty(component, i);
              }
              return ret;
          })
          : [];
      $$.update();
      ready = true;
      run_all($$.before_update);
      // `false` as a special case of no DOM component
      $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
      if (options.target) {
          if (options.hydrate) {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              $$.fragment && $$.fragment.l(children(options.target));
          }
          else {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              $$.fragment && $$.fragment.c();
          }
          if (options.intro)
              transition_in(component.$$.fragment);
          mount_component(component, options.target, options.anchor);
          flush();
      }
      set_current_component(parent_component);
  }
  class SvelteComponent {
      $destroy() {
          destroy_component(this, 1);
          this.$destroy = noop;
      }
      $on(type, callback) {
          const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
          callbacks.push(callback);
          return () => {
              const index = callbacks.indexOf(callback);
              if (index !== -1)
                  callbacks.splice(index, 1);
          };
      }
      $set() {
          // overridden by instance, if it has props
      }
  }

  function forwardEventsBuilder(component, additionalEvents = []) {
    const events = [
      'focus', 'blur',
      'fullscreenchange', 'fullscreenerror', 'scroll',
      'cut', 'copy', 'paste',
      'keydown', 'keypress', 'keyup',
      'auxclick', 'click', 'contextmenu', 'dblclick', 'mousedown', 'mouseenter', 'mouseleave', 'mousemove', 'mouseover', 'mouseout', 'mouseup', 'pointerlockchange', 'pointerlockerror', 'select', 'wheel',
      'drag', 'dragend', 'dragenter', 'dragstart', 'dragleave', 'dragover', 'drop',
      'touchcancel', 'touchend', 'touchmove', 'touchstart',
      'pointerover', 'pointerenter', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerout', 'pointerleave', 'gotpointercapture', 'lostpointercapture',
      ...additionalEvents
    ];

    function forward(e) {
      bubble(component, e);
    }

    return node => {
      const destructors = [];

      for (let i = 0; i < events.length; i++) {
        destructors.push(listen(node, events[i], forward));
      }

      return {
        destroy: () => {
          for (let i = 0; i < destructors.length; i++) {
            destructors[i]();
          }
        }
      }
    };
  }

  function exclude(obj, keys) {
    let names = Object.getOwnPropertyNames(obj);
    const newObj = {};

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const cashIndex = name.indexOf('$');
      if (cashIndex !== -1 && keys.indexOf(name.substring(0, cashIndex + 1)) !== -1) {
        continue;
      }
      if (keys.indexOf(name) !== -1) {
        continue;
      }
      newObj[name] = obj[name];
    }

    return newObj;
  }

  function useActions(node, actions) {
    let objects = [];

    if (actions) {
      for (let i = 0; i < actions.length; i++) {
        const isArray = Array.isArray(actions[i]);
        const action = isArray ? actions[i][0] : actions[i];
        if (isArray && actions[i].length > 1) {
          objects.push(action(node, actions[i][1]));
        } else {
          objects.push(action(node));
        }
      }
    }

    return {
      update(actions) {
        if ((actions && actions.length || 0) != objects.length) {
          throw new Error('You must not change the length of an actions array.');
        }

        if (actions) {
          for (let i = 0; i < actions.length; i++) {
            if (objects[i] && 'update' in objects[i]) {
              const isArray = Array.isArray(actions[i]);
              if (isArray && actions[i].length > 1) {
                objects[i].update(actions[i][1]);
              } else {
                objects[i].update();
              }
            }
          }
        }
      },

      destroy() {
        for (let i = 0; i < objects.length; i++) {
          if (objects[i] && 'destroy' in objects[i]) {
            objects[i].destroy();
          }
        }
      }
    }
  }

  /* node_modules\@smui\card\Card.svelte generated by Svelte v3.18.1 */

  function create_fragment(ctx) {
  	let div;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[7].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[6], null);

  	let div_levels = [
  		{
  			class: "\n    mdc-card\n    " + /*className*/ ctx[1] + "\n    " + (/*variant*/ ctx[2] === "outlined"
  			? "mdc-card--outlined"
  			: "") + "\n    " + (/*padded*/ ctx[3] ? "smui-card--padded" : "") + "\n  "
  		},
  		exclude(/*$$props*/ ctx[5], ["use", "class", "variant", "padded"])
  	];

  	let div_data = {};

  	for (let i = 0; i < div_levels.length; i += 1) {
  		div_data = assign(div_data, div_levels[i]);
  	}

  	return {
  		c() {
  			div = element("div");
  			if (default_slot) default_slot.c();
  			set_attributes(div, div_data);
  		},
  		m(target, anchor) {
  			insert(target, div, anchor);

  			if (default_slot) {
  				default_slot.m(div, null);
  			}

  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, div, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[4].call(null, div))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 64) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[6], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[6], dirty, null));
  			}

  			set_attributes(div, get_spread_update(div_levels, [
  				dirty & /*className, variant, padded*/ 14 && {
  					class: "\n    mdc-card\n    " + /*className*/ ctx[1] + "\n    " + (/*variant*/ ctx[2] === "outlined"
  					? "mdc-card--outlined"
  					: "") + "\n    " + (/*padded*/ ctx[3] ? "smui-card--padded" : "") + "\n  "
  				},
  				dirty & /*exclude, $$props*/ 32 && exclude(/*$$props*/ ctx[5], ["use", "class", "variant", "padded"])
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div);
  			if (default_slot) default_slot.d(detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { variant = "raised" } = $$props;
  	let { padded = false } = $$props;
  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(5, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("variant" in $$new_props) $$invalidate(2, variant = $$new_props.variant);
  		if ("padded" in $$new_props) $$invalidate(3, padded = $$new_props.padded);
  		if ("$$scope" in $$new_props) $$invalidate(6, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);
  	return [use, className, variant, padded, forwardEvents, $$props, $$scope, $$slots];
  }

  class Card extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance, create_fragment, safe_not_equal, { use: 0, class: 1, variant: 2, padded: 3 });
  	}
  }

  /**
   * Stores result from supportsCssVariables to avoid redundant processing to
   * detect CSS custom variable support.
   */
  var supportsCssVariables_;
  function detectEdgePseudoVarBug(windowObj) {
      // Detect versions of Edge with buggy var() support
      // See: https://developer.microsoft.com/en-us/microsoft-edge/platform/issues/11495448/
      var document = windowObj.document;
      var node = document.createElement('div');
      node.className = 'mdc-ripple-surface--test-edge-var-bug';
      // Append to head instead of body because this script might be invoked in the
      // head, in which case the body doesn't exist yet. The probe works either way.
      document.head.appendChild(node);
      // The bug exists if ::before style ends up propagating to the parent element.
      // Additionally, getComputedStyle returns null in iframes with display: "none" in Firefox,
      // but Firefox is known to support CSS custom properties correctly.
      // See: https://bugzilla.mozilla.org/show_bug.cgi?id=548397
      var computedStyle = windowObj.getComputedStyle(node);
      var hasPseudoVarBug = computedStyle !== null && computedStyle.borderTopStyle === 'solid';
      if (node.parentNode) {
          node.parentNode.removeChild(node);
      }
      return hasPseudoVarBug;
  }
  function supportsCssVariables(windowObj, forceRefresh) {
      if (forceRefresh === void 0) { forceRefresh = false; }
      var CSS = windowObj.CSS;
      var supportsCssVars = supportsCssVariables_;
      if (typeof supportsCssVariables_ === 'boolean' && !forceRefresh) {
          return supportsCssVariables_;
      }
      var supportsFunctionPresent = CSS && typeof CSS.supports === 'function';
      if (!supportsFunctionPresent) {
          return false;
      }
      var explicitlySupportsCssVars = CSS.supports('--css-vars', 'yes');
      // See: https://bugs.webkit.org/show_bug.cgi?id=154669
      // See: README section on Safari
      var weAreFeatureDetectingSafari10plus = (CSS.supports('(--css-vars: yes)') &&
          CSS.supports('color', '#00000000'));
      if (explicitlySupportsCssVars || weAreFeatureDetectingSafari10plus) {
          supportsCssVars = !detectEdgePseudoVarBug(windowObj);
      }
      else {
          supportsCssVars = false;
      }
      if (!forceRefresh) {
          supportsCssVariables_ = supportsCssVars;
      }
      return supportsCssVars;
  }
  function getNormalizedEventCoords(evt, pageOffset, clientRect) {
      if (!evt) {
          return { x: 0, y: 0 };
      }
      var x = pageOffset.x, y = pageOffset.y;
      var documentX = x + clientRect.left;
      var documentY = y + clientRect.top;
      var normalizedX;
      var normalizedY;
      // Determine touch point relative to the ripple container.
      if (evt.type === 'touchstart') {
          var touchEvent = evt;
          normalizedX = touchEvent.changedTouches[0].pageX - documentX;
          normalizedY = touchEvent.changedTouches[0].pageY - documentY;
      }
      else {
          var mouseEvent = evt;
          normalizedX = mouseEvent.pageX - documentX;
          normalizedY = mouseEvent.pageY - documentY;
      }
      return { x: normalizedX, y: normalizedY };
  }

  /*! *****************************************************************************
  Copyright (c) Microsoft Corporation. All rights reserved.
  Licensed under the Apache License, Version 2.0 (the "License"); you may not use
  this file except in compliance with the License. You may obtain a copy of the
  License at http://www.apache.org/licenses/LICENSE-2.0

  THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
  WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
  MERCHANTABLITY OR NON-INFRINGEMENT.

  See the Apache Version 2.0 License for specific language governing permissions
  and limitations under the License.
  ***************************************************************************** */
  /* global Reflect, Promise */

  var extendStatics = function(d, b) {
      extendStatics = Object.setPrototypeOf ||
          ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
          function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
      return extendStatics(d, b);
  };

  function __extends(d, b) {
      extendStatics(d, b);
      function __() { this.constructor = d; }
      d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
  }

  var __assign = function() {
      __assign = Object.assign || function __assign(t) {
          for (var s, i = 1, n = arguments.length; i < n; i++) {
              s = arguments[i];
              for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
          }
          return t;
      };
      return __assign.apply(this, arguments);
  };

  function __read(o, n) {
      var m = typeof Symbol === "function" && o[Symbol.iterator];
      if (!m) return o;
      var i = m.call(o), r, ar = [], e;
      try {
          while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
      }
      catch (error) { e = { error: error }; }
      finally {
          try {
              if (r && !r.done && (m = i["return"])) m.call(i);
          }
          finally { if (e) throw e.error; }
      }
      return ar;
  }

  function __spread() {
      for (var ar = [], i = 0; i < arguments.length; i++)
          ar = ar.concat(__read(arguments[i]));
      return ar;
  }

  /**
   * @license
   * Copyright 2016 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var MDCFoundation = /** @class */ (function () {
      function MDCFoundation(adapter) {
          if (adapter === void 0) { adapter = {}; }
          this.adapter_ = adapter;
      }
      Object.defineProperty(MDCFoundation, "cssClasses", {
          get: function () {
              // Classes extending MDCFoundation should implement this method to return an object which exports every
              // CSS class the foundation class needs as a property. e.g. {ACTIVE: 'mdc-component--active'}
              return {};
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCFoundation, "strings", {
          get: function () {
              // Classes extending MDCFoundation should implement this method to return an object which exports all
              // semantic strings as constants. e.g. {ARIA_ROLE: 'tablist'}
              return {};
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCFoundation, "numbers", {
          get: function () {
              // Classes extending MDCFoundation should implement this method to return an object which exports all
              // of its semantic numbers as constants. e.g. {ANIMATION_DELAY_MS: 350}
              return {};
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCFoundation, "defaultAdapter", {
          get: function () {
              // Classes extending MDCFoundation may choose to implement this getter in order to provide a convenient
              // way of viewing the necessary methods of an adapter. In the future, this could also be used for adapter
              // validation.
              return {};
          },
          enumerable: true,
          configurable: true
      });
      MDCFoundation.prototype.init = function () {
          // Subclasses should override this method to perform initialization routines (registering events, etc.)
      };
      MDCFoundation.prototype.destroy = function () {
          // Subclasses should override this method to perform de-initialization routines (de-registering events, etc.)
      };
      return MDCFoundation;
  }());

  /**
   * @license
   * Copyright 2016 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var MDCComponent = /** @class */ (function () {
      function MDCComponent(root, foundation) {
          var args = [];
          for (var _i = 2; _i < arguments.length; _i++) {
              args[_i - 2] = arguments[_i];
          }
          this.root_ = root;
          this.initialize.apply(this, __spread(args));
          // Note that we initialize foundation here and not within the constructor's default param so that
          // this.root_ is defined and can be used within the foundation class.
          this.foundation_ = foundation === undefined ? this.getDefaultFoundation() : foundation;
          this.foundation_.init();
          this.initialSyncWithDOM();
      }
      MDCComponent.attachTo = function (root) {
          // Subclasses which extend MDCBase should provide an attachTo() method that takes a root element and
          // returns an instantiated component with its root set to that element. Also note that in the cases of
          // subclasses, an explicit foundation class will not have to be passed in; it will simply be initialized
          // from getDefaultFoundation().
          return new MDCComponent(root, new MDCFoundation({}));
      };
      /* istanbul ignore next: method param only exists for typing purposes; it does not need to be unit tested */
      MDCComponent.prototype.initialize = function () {
          var _args = [];
          for (var _i = 0; _i < arguments.length; _i++) {
              _args[_i] = arguments[_i];
          }
          // Subclasses can override this to do any additional setup work that would be considered part of a
          // "constructor". Essentially, it is a hook into the parent constructor before the foundation is
          // initialized. Any additional arguments besides root and foundation will be passed in here.
      };
      MDCComponent.prototype.getDefaultFoundation = function () {
          // Subclasses must override this method to return a properly configured foundation class for the
          // component.
          throw new Error('Subclasses must override getDefaultFoundation to return a properly configured ' +
              'foundation class');
      };
      MDCComponent.prototype.initialSyncWithDOM = function () {
          // Subclasses should override this method if they need to perform work to synchronize with a host DOM
          // object. An example of this would be a form control wrapper that needs to synchronize its internal state
          // to some property or attribute of the host DOM. Please note: this is *not* the place to perform DOM
          // reads/writes that would cause layout / paint, as this is called synchronously from within the constructor.
      };
      MDCComponent.prototype.destroy = function () {
          // Subclasses may implement this method to release any resources / deregister any listeners they have
          // attached. An example of this might be deregistering a resize event from the window object.
          this.foundation_.destroy();
      };
      MDCComponent.prototype.listen = function (evtType, handler, options) {
          this.root_.addEventListener(evtType, handler, options);
      };
      MDCComponent.prototype.unlisten = function (evtType, handler, options) {
          this.root_.removeEventListener(evtType, handler, options);
      };
      /**
       * Fires a cross-browser-compatible custom event from the component root of the given type, with the given data.
       */
      MDCComponent.prototype.emit = function (evtType, evtData, shouldBubble) {
          if (shouldBubble === void 0) { shouldBubble = false; }
          var evt;
          if (typeof CustomEvent === 'function') {
              evt = new CustomEvent(evtType, {
                  bubbles: shouldBubble,
                  detail: evtData,
              });
          }
          else {
              evt = document.createEvent('CustomEvent');
              evt.initCustomEvent(evtType, shouldBubble, false, evtData);
          }
          this.root_.dispatchEvent(evt);
      };
      return MDCComponent;
  }());

  /**
   * @license
   * Copyright 2019 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  /**
   * Stores result from applyPassive to avoid redundant processing to detect
   * passive event listener support.
   */
  var supportsPassive_;
  /**
   * Determine whether the current browser supports passive event listeners, and
   * if so, use them.
   */
  function applyPassive(globalObj, forceRefresh) {
      if (globalObj === void 0) { globalObj = window; }
      if (forceRefresh === void 0) { forceRefresh = false; }
      if (supportsPassive_ === undefined || forceRefresh) {
          var isSupported_1 = false;
          try {
              globalObj.document.addEventListener('test', function () { return undefined; }, {
                  get passive() {
                      isSupported_1 = true;
                      return isSupported_1;
                  },
              });
          }
          catch (e) {
          } // tslint:disable-line:no-empty cannot throw error due to tests. tslint also disables console.log.
          supportsPassive_ = isSupported_1;
      }
      return supportsPassive_ ? { passive: true } : false;
  }

  /**
   * @license
   * Copyright 2018 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  function matches(element, selector) {
      var nativeMatches = element.matches
          || element.webkitMatchesSelector
          || element.msMatchesSelector;
      return nativeMatches.call(element, selector);
  }

  /**
   * @license
   * Copyright 2016 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var cssClasses = {
      // Ripple is a special case where the "root" component is really a "mixin" of sorts,
      // given that it's an 'upgrade' to an existing component. That being said it is the root
      // CSS class that all other CSS classes derive from.
      BG_FOCUSED: 'mdc-ripple-upgraded--background-focused',
      FG_ACTIVATION: 'mdc-ripple-upgraded--foreground-activation',
      FG_DEACTIVATION: 'mdc-ripple-upgraded--foreground-deactivation',
      ROOT: 'mdc-ripple-upgraded',
      UNBOUNDED: 'mdc-ripple-upgraded--unbounded',
  };
  var strings = {
      VAR_FG_SCALE: '--mdc-ripple-fg-scale',
      VAR_FG_SIZE: '--mdc-ripple-fg-size',
      VAR_FG_TRANSLATE_END: '--mdc-ripple-fg-translate-end',
      VAR_FG_TRANSLATE_START: '--mdc-ripple-fg-translate-start',
      VAR_LEFT: '--mdc-ripple-left',
      VAR_TOP: '--mdc-ripple-top',
  };
  var numbers = {
      DEACTIVATION_TIMEOUT_MS: 225,
      FG_DEACTIVATION_MS: 150,
      INITIAL_ORIGIN_SCALE: 0.6,
      PADDING: 10,
      TAP_DELAY_MS: 300,
  };

  /**
   * @license
   * Copyright 2016 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  // Activation events registered on the root element of each instance for activation
  var ACTIVATION_EVENT_TYPES = [
      'touchstart', 'pointerdown', 'mousedown', 'keydown',
  ];
  // Deactivation events registered on documentElement when a pointer-related down event occurs
  var POINTER_DEACTIVATION_EVENT_TYPES = [
      'touchend', 'pointerup', 'mouseup', 'contextmenu',
  ];
  // simultaneous nested activations
  var activatedTargets = [];
  var MDCRippleFoundation = /** @class */ (function (_super) {
      __extends(MDCRippleFoundation, _super);
      function MDCRippleFoundation(adapter) {
          var _this = _super.call(this, __assign({}, MDCRippleFoundation.defaultAdapter, adapter)) || this;
          _this.activationAnimationHasEnded_ = false;
          _this.activationTimer_ = 0;
          _this.fgDeactivationRemovalTimer_ = 0;
          _this.fgScale_ = '0';
          _this.frame_ = { width: 0, height: 0 };
          _this.initialSize_ = 0;
          _this.layoutFrame_ = 0;
          _this.maxRadius_ = 0;
          _this.unboundedCoords_ = { left: 0, top: 0 };
          _this.activationState_ = _this.defaultActivationState_();
          _this.activationTimerCallback_ = function () {
              _this.activationAnimationHasEnded_ = true;
              _this.runDeactivationUXLogicIfReady_();
          };
          _this.activateHandler_ = function (e) { return _this.activate_(e); };
          _this.deactivateHandler_ = function () { return _this.deactivate_(); };
          _this.focusHandler_ = function () { return _this.handleFocus(); };
          _this.blurHandler_ = function () { return _this.handleBlur(); };
          _this.resizeHandler_ = function () { return _this.layout(); };
          return _this;
      }
      Object.defineProperty(MDCRippleFoundation, "cssClasses", {
          get: function () {
              return cssClasses;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCRippleFoundation, "strings", {
          get: function () {
              return strings;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCRippleFoundation, "numbers", {
          get: function () {
              return numbers;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCRippleFoundation, "defaultAdapter", {
          get: function () {
              return {
                  addClass: function () { return undefined; },
                  browserSupportsCssVars: function () { return true; },
                  computeBoundingRect: function () { return ({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 }); },
                  containsEventTarget: function () { return true; },
                  deregisterDocumentInteractionHandler: function () { return undefined; },
                  deregisterInteractionHandler: function () { return undefined; },
                  deregisterResizeHandler: function () { return undefined; },
                  getWindowPageOffset: function () { return ({ x: 0, y: 0 }); },
                  isSurfaceActive: function () { return true; },
                  isSurfaceDisabled: function () { return true; },
                  isUnbounded: function () { return true; },
                  registerDocumentInteractionHandler: function () { return undefined; },
                  registerInteractionHandler: function () { return undefined; },
                  registerResizeHandler: function () { return undefined; },
                  removeClass: function () { return undefined; },
                  updateCssVariable: function () { return undefined; },
              };
          },
          enumerable: true,
          configurable: true
      });
      MDCRippleFoundation.prototype.init = function () {
          var _this = this;
          var supportsPressRipple = this.supportsPressRipple_();
          this.registerRootHandlers_(supportsPressRipple);
          if (supportsPressRipple) {
              var _a = MDCRippleFoundation.cssClasses, ROOT_1 = _a.ROOT, UNBOUNDED_1 = _a.UNBOUNDED;
              requestAnimationFrame(function () {
                  _this.adapter_.addClass(ROOT_1);
                  if (_this.adapter_.isUnbounded()) {
                      _this.adapter_.addClass(UNBOUNDED_1);
                      // Unbounded ripples need layout logic applied immediately to set coordinates for both shade and ripple
                      _this.layoutInternal_();
                  }
              });
          }
      };
      MDCRippleFoundation.prototype.destroy = function () {
          var _this = this;
          if (this.supportsPressRipple_()) {
              if (this.activationTimer_) {
                  clearTimeout(this.activationTimer_);
                  this.activationTimer_ = 0;
                  this.adapter_.removeClass(MDCRippleFoundation.cssClasses.FG_ACTIVATION);
              }
              if (this.fgDeactivationRemovalTimer_) {
                  clearTimeout(this.fgDeactivationRemovalTimer_);
                  this.fgDeactivationRemovalTimer_ = 0;
                  this.adapter_.removeClass(MDCRippleFoundation.cssClasses.FG_DEACTIVATION);
              }
              var _a = MDCRippleFoundation.cssClasses, ROOT_2 = _a.ROOT, UNBOUNDED_2 = _a.UNBOUNDED;
              requestAnimationFrame(function () {
                  _this.adapter_.removeClass(ROOT_2);
                  _this.adapter_.removeClass(UNBOUNDED_2);
                  _this.removeCssVars_();
              });
          }
          this.deregisterRootHandlers_();
          this.deregisterDeactivationHandlers_();
      };
      /**
       * @param evt Optional event containing position information.
       */
      MDCRippleFoundation.prototype.activate = function (evt) {
          this.activate_(evt);
      };
      MDCRippleFoundation.prototype.deactivate = function () {
          this.deactivate_();
      };
      MDCRippleFoundation.prototype.layout = function () {
          var _this = this;
          if (this.layoutFrame_) {
              cancelAnimationFrame(this.layoutFrame_);
          }
          this.layoutFrame_ = requestAnimationFrame(function () {
              _this.layoutInternal_();
              _this.layoutFrame_ = 0;
          });
      };
      MDCRippleFoundation.prototype.setUnbounded = function (unbounded) {
          var UNBOUNDED = MDCRippleFoundation.cssClasses.UNBOUNDED;
          if (unbounded) {
              this.adapter_.addClass(UNBOUNDED);
          }
          else {
              this.adapter_.removeClass(UNBOUNDED);
          }
      };
      MDCRippleFoundation.prototype.handleFocus = function () {
          var _this = this;
          requestAnimationFrame(function () {
              return _this.adapter_.addClass(MDCRippleFoundation.cssClasses.BG_FOCUSED);
          });
      };
      MDCRippleFoundation.prototype.handleBlur = function () {
          var _this = this;
          requestAnimationFrame(function () {
              return _this.adapter_.removeClass(MDCRippleFoundation.cssClasses.BG_FOCUSED);
          });
      };
      /**
       * We compute this property so that we are not querying information about the client
       * until the point in time where the foundation requests it. This prevents scenarios where
       * client-side feature-detection may happen too early, such as when components are rendered on the server
       * and then initialized at mount time on the client.
       */
      MDCRippleFoundation.prototype.supportsPressRipple_ = function () {
          return this.adapter_.browserSupportsCssVars();
      };
      MDCRippleFoundation.prototype.defaultActivationState_ = function () {
          return {
              activationEvent: undefined,
              hasDeactivationUXRun: false,
              isActivated: false,
              isProgrammatic: false,
              wasActivatedByPointer: false,
              wasElementMadeActive: false,
          };
      };
      /**
       * supportsPressRipple Passed from init to save a redundant function call
       */
      MDCRippleFoundation.prototype.registerRootHandlers_ = function (supportsPressRipple) {
          var _this = this;
          if (supportsPressRipple) {
              ACTIVATION_EVENT_TYPES.forEach(function (evtType) {
                  _this.adapter_.registerInteractionHandler(evtType, _this.activateHandler_);
              });
              if (this.adapter_.isUnbounded()) {
                  this.adapter_.registerResizeHandler(this.resizeHandler_);
              }
          }
          this.adapter_.registerInteractionHandler('focus', this.focusHandler_);
          this.adapter_.registerInteractionHandler('blur', this.blurHandler_);
      };
      MDCRippleFoundation.prototype.registerDeactivationHandlers_ = function (evt) {
          var _this = this;
          if (evt.type === 'keydown') {
              this.adapter_.registerInteractionHandler('keyup', this.deactivateHandler_);
          }
          else {
              POINTER_DEACTIVATION_EVENT_TYPES.forEach(function (evtType) {
                  _this.adapter_.registerDocumentInteractionHandler(evtType, _this.deactivateHandler_);
              });
          }
      };
      MDCRippleFoundation.prototype.deregisterRootHandlers_ = function () {
          var _this = this;
          ACTIVATION_EVENT_TYPES.forEach(function (evtType) {
              _this.adapter_.deregisterInteractionHandler(evtType, _this.activateHandler_);
          });
          this.adapter_.deregisterInteractionHandler('focus', this.focusHandler_);
          this.adapter_.deregisterInteractionHandler('blur', this.blurHandler_);
          if (this.adapter_.isUnbounded()) {
              this.adapter_.deregisterResizeHandler(this.resizeHandler_);
          }
      };
      MDCRippleFoundation.prototype.deregisterDeactivationHandlers_ = function () {
          var _this = this;
          this.adapter_.deregisterInteractionHandler('keyup', this.deactivateHandler_);
          POINTER_DEACTIVATION_EVENT_TYPES.forEach(function (evtType) {
              _this.adapter_.deregisterDocumentInteractionHandler(evtType, _this.deactivateHandler_);
          });
      };
      MDCRippleFoundation.prototype.removeCssVars_ = function () {
          var _this = this;
          var rippleStrings = MDCRippleFoundation.strings;
          var keys = Object.keys(rippleStrings);
          keys.forEach(function (key) {
              if (key.indexOf('VAR_') === 0) {
                  _this.adapter_.updateCssVariable(rippleStrings[key], null);
              }
          });
      };
      MDCRippleFoundation.prototype.activate_ = function (evt) {
          var _this = this;
          if (this.adapter_.isSurfaceDisabled()) {
              return;
          }
          var activationState = this.activationState_;
          if (activationState.isActivated) {
              return;
          }
          // Avoid reacting to follow-on events fired by touch device after an already-processed user interaction
          var previousActivationEvent = this.previousActivationEvent_;
          var isSameInteraction = previousActivationEvent && evt !== undefined && previousActivationEvent.type !== evt.type;
          if (isSameInteraction) {
              return;
          }
          activationState.isActivated = true;
          activationState.isProgrammatic = evt === undefined;
          activationState.activationEvent = evt;
          activationState.wasActivatedByPointer = activationState.isProgrammatic ? false : evt !== undefined && (evt.type === 'mousedown' || evt.type === 'touchstart' || evt.type === 'pointerdown');
          var hasActivatedChild = evt !== undefined && activatedTargets.length > 0 && activatedTargets.some(function (target) { return _this.adapter_.containsEventTarget(target); });
          if (hasActivatedChild) {
              // Immediately reset activation state, while preserving logic that prevents touch follow-on events
              this.resetActivationState_();
              return;
          }
          if (evt !== undefined) {
              activatedTargets.push(evt.target);
              this.registerDeactivationHandlers_(evt);
          }
          activationState.wasElementMadeActive = this.checkElementMadeActive_(evt);
          if (activationState.wasElementMadeActive) {
              this.animateActivation_();
          }
          requestAnimationFrame(function () {
              // Reset array on next frame after the current event has had a chance to bubble to prevent ancestor ripples
              activatedTargets = [];
              if (!activationState.wasElementMadeActive
                  && evt !== undefined
                  && (evt.key === ' ' || evt.keyCode === 32)) {
                  // If space was pressed, try again within an rAF call to detect :active, because different UAs report
                  // active states inconsistently when they're called within event handling code:
                  // - https://bugs.chromium.org/p/chromium/issues/detail?id=635971
                  // - https://bugzilla.mozilla.org/show_bug.cgi?id=1293741
                  // We try first outside rAF to support Edge, which does not exhibit this problem, but will crash if a CSS
                  // variable is set within a rAF callback for a submit button interaction (#2241).
                  activationState.wasElementMadeActive = _this.checkElementMadeActive_(evt);
                  if (activationState.wasElementMadeActive) {
                      _this.animateActivation_();
                  }
              }
              if (!activationState.wasElementMadeActive) {
                  // Reset activation state immediately if element was not made active.
                  _this.activationState_ = _this.defaultActivationState_();
              }
          });
      };
      MDCRippleFoundation.prototype.checkElementMadeActive_ = function (evt) {
          return (evt !== undefined && evt.type === 'keydown') ? this.adapter_.isSurfaceActive() : true;
      };
      MDCRippleFoundation.prototype.animateActivation_ = function () {
          var _this = this;
          var _a = MDCRippleFoundation.strings, VAR_FG_TRANSLATE_START = _a.VAR_FG_TRANSLATE_START, VAR_FG_TRANSLATE_END = _a.VAR_FG_TRANSLATE_END;
          var _b = MDCRippleFoundation.cssClasses, FG_DEACTIVATION = _b.FG_DEACTIVATION, FG_ACTIVATION = _b.FG_ACTIVATION;
          var DEACTIVATION_TIMEOUT_MS = MDCRippleFoundation.numbers.DEACTIVATION_TIMEOUT_MS;
          this.layoutInternal_();
          var translateStart = '';
          var translateEnd = '';
          if (!this.adapter_.isUnbounded()) {
              var _c = this.getFgTranslationCoordinates_(), startPoint = _c.startPoint, endPoint = _c.endPoint;
              translateStart = startPoint.x + "px, " + startPoint.y + "px";
              translateEnd = endPoint.x + "px, " + endPoint.y + "px";
          }
          this.adapter_.updateCssVariable(VAR_FG_TRANSLATE_START, translateStart);
          this.adapter_.updateCssVariable(VAR_FG_TRANSLATE_END, translateEnd);
          // Cancel any ongoing activation/deactivation animations
          clearTimeout(this.activationTimer_);
          clearTimeout(this.fgDeactivationRemovalTimer_);
          this.rmBoundedActivationClasses_();
          this.adapter_.removeClass(FG_DEACTIVATION);
          // Force layout in order to re-trigger the animation.
          this.adapter_.computeBoundingRect();
          this.adapter_.addClass(FG_ACTIVATION);
          this.activationTimer_ = setTimeout(function () { return _this.activationTimerCallback_(); }, DEACTIVATION_TIMEOUT_MS);
      };
      MDCRippleFoundation.prototype.getFgTranslationCoordinates_ = function () {
          var _a = this.activationState_, activationEvent = _a.activationEvent, wasActivatedByPointer = _a.wasActivatedByPointer;
          var startPoint;
          if (wasActivatedByPointer) {
              startPoint = getNormalizedEventCoords(activationEvent, this.adapter_.getWindowPageOffset(), this.adapter_.computeBoundingRect());
          }
          else {
              startPoint = {
                  x: this.frame_.width / 2,
                  y: this.frame_.height / 2,
              };
          }
          // Center the element around the start point.
          startPoint = {
              x: startPoint.x - (this.initialSize_ / 2),
              y: startPoint.y - (this.initialSize_ / 2),
          };
          var endPoint = {
              x: (this.frame_.width / 2) - (this.initialSize_ / 2),
              y: (this.frame_.height / 2) - (this.initialSize_ / 2),
          };
          return { startPoint: startPoint, endPoint: endPoint };
      };
      MDCRippleFoundation.prototype.runDeactivationUXLogicIfReady_ = function () {
          var _this = this;
          // This method is called both when a pointing device is released, and when the activation animation ends.
          // The deactivation animation should only run after both of those occur.
          var FG_DEACTIVATION = MDCRippleFoundation.cssClasses.FG_DEACTIVATION;
          var _a = this.activationState_, hasDeactivationUXRun = _a.hasDeactivationUXRun, isActivated = _a.isActivated;
          var activationHasEnded = hasDeactivationUXRun || !isActivated;
          if (activationHasEnded && this.activationAnimationHasEnded_) {
              this.rmBoundedActivationClasses_();
              this.adapter_.addClass(FG_DEACTIVATION);
              this.fgDeactivationRemovalTimer_ = setTimeout(function () {
                  _this.adapter_.removeClass(FG_DEACTIVATION);
              }, numbers.FG_DEACTIVATION_MS);
          }
      };
      MDCRippleFoundation.prototype.rmBoundedActivationClasses_ = function () {
          var FG_ACTIVATION = MDCRippleFoundation.cssClasses.FG_ACTIVATION;
          this.adapter_.removeClass(FG_ACTIVATION);
          this.activationAnimationHasEnded_ = false;
          this.adapter_.computeBoundingRect();
      };
      MDCRippleFoundation.prototype.resetActivationState_ = function () {
          var _this = this;
          this.previousActivationEvent_ = this.activationState_.activationEvent;
          this.activationState_ = this.defaultActivationState_();
          // Touch devices may fire additional events for the same interaction within a short time.
          // Store the previous event until it's safe to assume that subsequent events are for new interactions.
          setTimeout(function () { return _this.previousActivationEvent_ = undefined; }, MDCRippleFoundation.numbers.TAP_DELAY_MS);
      };
      MDCRippleFoundation.prototype.deactivate_ = function () {
          var _this = this;
          var activationState = this.activationState_;
          // This can happen in scenarios such as when you have a keyup event that blurs the element.
          if (!activationState.isActivated) {
              return;
          }
          var state = __assign({}, activationState);
          if (activationState.isProgrammatic) {
              requestAnimationFrame(function () { return _this.animateDeactivation_(state); });
              this.resetActivationState_();
          }
          else {
              this.deregisterDeactivationHandlers_();
              requestAnimationFrame(function () {
                  _this.activationState_.hasDeactivationUXRun = true;
                  _this.animateDeactivation_(state);
                  _this.resetActivationState_();
              });
          }
      };
      MDCRippleFoundation.prototype.animateDeactivation_ = function (_a) {
          var wasActivatedByPointer = _a.wasActivatedByPointer, wasElementMadeActive = _a.wasElementMadeActive;
          if (wasActivatedByPointer || wasElementMadeActive) {
              this.runDeactivationUXLogicIfReady_();
          }
      };
      MDCRippleFoundation.prototype.layoutInternal_ = function () {
          var _this = this;
          this.frame_ = this.adapter_.computeBoundingRect();
          var maxDim = Math.max(this.frame_.height, this.frame_.width);
          // Surface diameter is treated differently for unbounded vs. bounded ripples.
          // Unbounded ripple diameter is calculated smaller since the surface is expected to already be padded appropriately
          // to extend the hitbox, and the ripple is expected to meet the edges of the padded hitbox (which is typically
          // square). Bounded ripples, on the other hand, are fully expected to expand beyond the surface's longest diameter
          // (calculated based on the diagonal plus a constant padding), and are clipped at the surface's border via
          // `overflow: hidden`.
          var getBoundedRadius = function () {
              var hypotenuse = Math.sqrt(Math.pow(_this.frame_.width, 2) + Math.pow(_this.frame_.height, 2));
              return hypotenuse + MDCRippleFoundation.numbers.PADDING;
          };
          this.maxRadius_ = this.adapter_.isUnbounded() ? maxDim : getBoundedRadius();
          // Ripple is sized as a fraction of the largest dimension of the surface, then scales up using a CSS scale transform
          this.initialSize_ = Math.floor(maxDim * MDCRippleFoundation.numbers.INITIAL_ORIGIN_SCALE);
          this.fgScale_ = "" + this.maxRadius_ / this.initialSize_;
          this.updateLayoutCssVars_();
      };
      MDCRippleFoundation.prototype.updateLayoutCssVars_ = function () {
          var _a = MDCRippleFoundation.strings, VAR_FG_SIZE = _a.VAR_FG_SIZE, VAR_LEFT = _a.VAR_LEFT, VAR_TOP = _a.VAR_TOP, VAR_FG_SCALE = _a.VAR_FG_SCALE;
          this.adapter_.updateCssVariable(VAR_FG_SIZE, this.initialSize_ + "px");
          this.adapter_.updateCssVariable(VAR_FG_SCALE, this.fgScale_);
          if (this.adapter_.isUnbounded()) {
              this.unboundedCoords_ = {
                  left: Math.round((this.frame_.width / 2) - (this.initialSize_ / 2)),
                  top: Math.round((this.frame_.height / 2) - (this.initialSize_ / 2)),
              };
              this.adapter_.updateCssVariable(VAR_LEFT, this.unboundedCoords_.left + "px");
              this.adapter_.updateCssVariable(VAR_TOP, this.unboundedCoords_.top + "px");
          }
      };
      return MDCRippleFoundation;
  }(MDCFoundation));

  /**
   * @license
   * Copyright 2016 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var MDCRipple = /** @class */ (function (_super) {
      __extends(MDCRipple, _super);
      function MDCRipple() {
          var _this = _super !== null && _super.apply(this, arguments) || this;
          _this.disabled = false;
          return _this;
      }
      MDCRipple.attachTo = function (root, opts) {
          if (opts === void 0) { opts = { isUnbounded: undefined }; }
          var ripple = new MDCRipple(root);
          // Only override unbounded behavior if option is explicitly specified
          if (opts.isUnbounded !== undefined) {
              ripple.unbounded = opts.isUnbounded;
          }
          return ripple;
      };
      MDCRipple.createAdapter = function (instance) {
          return {
              addClass: function (className) { return instance.root_.classList.add(className); },
              browserSupportsCssVars: function () { return supportsCssVariables(window); },
              computeBoundingRect: function () { return instance.root_.getBoundingClientRect(); },
              containsEventTarget: function (target) { return instance.root_.contains(target); },
              deregisterDocumentInteractionHandler: function (evtType, handler) {
                  return document.documentElement.removeEventListener(evtType, handler, applyPassive());
              },
              deregisterInteractionHandler: function (evtType, handler) {
                  return instance.root_.removeEventListener(evtType, handler, applyPassive());
              },
              deregisterResizeHandler: function (handler) { return window.removeEventListener('resize', handler); },
              getWindowPageOffset: function () { return ({ x: window.pageXOffset, y: window.pageYOffset }); },
              isSurfaceActive: function () { return matches(instance.root_, ':active'); },
              isSurfaceDisabled: function () { return Boolean(instance.disabled); },
              isUnbounded: function () { return Boolean(instance.unbounded); },
              registerDocumentInteractionHandler: function (evtType, handler) {
                  return document.documentElement.addEventListener(evtType, handler, applyPassive());
              },
              registerInteractionHandler: function (evtType, handler) {
                  return instance.root_.addEventListener(evtType, handler, applyPassive());
              },
              registerResizeHandler: function (handler) { return window.addEventListener('resize', handler); },
              removeClass: function (className) { return instance.root_.classList.remove(className); },
              updateCssVariable: function (varName, value) { return instance.root_.style.setProperty(varName, value); },
          };
      };
      Object.defineProperty(MDCRipple.prototype, "unbounded", {
          get: function () {
              return Boolean(this.unbounded_);
          },
          set: function (unbounded) {
              this.unbounded_ = Boolean(unbounded);
              this.setUnbounded_();
          },
          enumerable: true,
          configurable: true
      });
      MDCRipple.prototype.activate = function () {
          this.foundation_.activate();
      };
      MDCRipple.prototype.deactivate = function () {
          this.foundation_.deactivate();
      };
      MDCRipple.prototype.layout = function () {
          this.foundation_.layout();
      };
      MDCRipple.prototype.getDefaultFoundation = function () {
          return new MDCRippleFoundation(MDCRipple.createAdapter(this));
      };
      MDCRipple.prototype.initialSyncWithDOM = function () {
          var root = this.root_;
          this.unbounded = 'mdcRippleIsUnbounded' in root.dataset;
      };
      /**
       * Closure Compiler throws an access control error when directly accessing a
       * protected or private property inside a getter/setter, like unbounded above.
       * By accessing the protected property inside a method, we solve that problem.
       * That's why this function exists.
       */
      MDCRipple.prototype.setUnbounded_ = function () {
          this.foundation_.setUnbounded(Boolean(this.unbounded_));
      };
      return MDCRipple;
  }(MDCComponent));

  function Ripple(node, props = {ripple: false, unbounded: false, color: null, classForward: () => {}}) {
    let instance = null;
    let addLayoutListener = getContext('SMUI:addLayoutListener');
    let removeLayoutListener;
    let classList = [];

    function addClass(className) {
      const idx = classList.indexOf(className);
      if (idx === -1) {
        node.classList.add(className);
        classList.push(className);
        if (props.classForward) {
          props.classForward(classList);
          console.log('addClass', className, classList);
        }
      }
    }

    function removeClass(className) {
      const idx = classList.indexOf(className);
      if (idx !== -1) {
        node.classList.remove(className);
        classList.splice(idx, 1);
        if (props.classForward) {
          props.classForward(classList);
          console.log('removeClass', className, classList);
        }
      }
    }

    function handleProps() {
      if (props.ripple && !instance) {
        // Override the Ripple component's adapter, so that we can forward classes
        // to Svelte components that overwrite Ripple's classes.
        const _createAdapter = MDCRipple.createAdapter;
        MDCRipple.createAdapter = function(...args) {
          const adapter = _createAdapter.apply(this, args);
          adapter.addClass = function(className) {
            return addClass(className);
          };
          adapter.removeClass = function(className) {
            return removeClass(className);
          };
          return adapter;
        };
        instance = new MDCRipple(node);
        MDCRipple.createAdapter = _createAdapter;
      } else if (instance && !props.ripple) {
        instance.destroy();
        instance = null;
      }
      if (props.ripple) {
        instance.unbounded = !!props.unbounded;
        switch (props.color) {
          case 'surface':
            addClass('mdc-ripple-surface');
            removeClass('mdc-ripple-surface--primary');
            removeClass('mdc-ripple-surface--accent');
            return;
          case 'primary':
            addClass('mdc-ripple-surface');
            addClass('mdc-ripple-surface--primary');
            removeClass('mdc-ripple-surface--accent');
            return;
          case 'secondary':
            addClass('mdc-ripple-surface');
            removeClass('mdc-ripple-surface--primary');
            addClass('mdc-ripple-surface--accent');
            return;
        }
      }
      removeClass('mdc-ripple-surface');
      removeClass('mdc-ripple-surface--primary');
      removeClass('mdc-ripple-surface--accent');
    }

    handleProps();

    if (addLayoutListener) {
      removeLayoutListener = addLayoutListener(layout);
    }

    function layout() {
      if (instance) {
        instance.layout();
      }
    }

    return {
      update(newProps = {ripple: false, unbounded: false, color: null, classForward: []}) {
        props = newProps;
        handleProps();
      },

      destroy() {
        if (instance) {
          instance.destroy();
          instance = null;
          removeClass('mdc-ripple-surface');
          removeClass('mdc-ripple-surface--primary');
          removeClass('mdc-ripple-surface--accent');
        }

        if (removeLayoutListener) {
          removeLayoutListener();
        }
      }
    }
  }

  /* node_modules\@smui\common\A.svelte generated by Svelte v3.18.1 */

  function create_fragment$1(ctx) {
  	let a;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[5].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[4], null);
  	let a_levels = [{ href: /*href*/ ctx[1] }, exclude(/*$$props*/ ctx[3], ["use", "href"])];
  	let a_data = {};

  	for (let i = 0; i < a_levels.length; i += 1) {
  		a_data = assign(a_data, a_levels[i]);
  	}

  	return {
  		c() {
  			a = element("a");
  			if (default_slot) default_slot.c();
  			set_attributes(a, a_data);
  		},
  		m(target, anchor) {
  			insert(target, a, anchor);

  			if (default_slot) {
  				default_slot.m(a, null);
  			}

  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, a, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[2].call(null, a))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 16) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[4], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[4], dirty, null));
  			}

  			set_attributes(a, get_spread_update(a_levels, [
  				dirty & /*href*/ 2 && { href: /*href*/ ctx[1] },
  				dirty & /*exclude, $$props*/ 8 && exclude(/*$$props*/ ctx[3], ["use", "href"])
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(a);
  			if (default_slot) default_slot.d(detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance$1($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { href = "javascript:void(0);" } = $$props;
  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(3, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("href" in $$new_props) $$invalidate(1, href = $$new_props.href);
  		if ("$$scope" in $$new_props) $$invalidate(4, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);
  	return [use, href, forwardEvents, $$props, $$scope, $$slots];
  }

  class A extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$1, create_fragment$1, safe_not_equal, { use: 0, href: 1 });
  	}
  }

  /* node_modules\@smui\common\Button.svelte generated by Svelte v3.18.1 */

  function create_fragment$2(ctx) {
  	let button;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[4].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[3], null);
  	let button_levels = [exclude(/*$$props*/ ctx[2], ["use"])];
  	let button_data = {};

  	for (let i = 0; i < button_levels.length; i += 1) {
  		button_data = assign(button_data, button_levels[i]);
  	}

  	return {
  		c() {
  			button = element("button");
  			if (default_slot) default_slot.c();
  			set_attributes(button, button_data);
  		},
  		m(target, anchor) {
  			insert(target, button, anchor);

  			if (default_slot) {
  				default_slot.m(button, null);
  			}

  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, button, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[1].call(null, button))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 8) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[3], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[3], dirty, null));
  			}

  			set_attributes(button, get_spread_update(button_levels, [dirty & /*exclude, $$props*/ 4 && exclude(/*$$props*/ ctx[2], ["use"])]));
  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(button);
  			if (default_slot) default_slot.d(detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance$2($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(2, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("$$scope" in $$new_props) $$invalidate(3, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);
  	return [use, forwardEvents, $$props, $$scope, $$slots];
  }

  class Button extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$2, create_fragment$2, safe_not_equal, { use: 0 });
  	}
  }

  /* node_modules\@smui\button\Button.svelte generated by Svelte v3.18.1 */

  function create_default_slot(ctx) {
  	let current;
  	const default_slot_template = /*$$slots*/ ctx[17].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[19], null);

  	return {
  		c() {
  			if (default_slot) default_slot.c();
  		},
  		m(target, anchor) {
  			if (default_slot) {
  				default_slot.m(target, anchor);
  			}

  			current = true;
  		},
  		p(ctx, dirty) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 524288) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[19], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[19], dirty, null));
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (default_slot) default_slot.d(detaching);
  		}
  	};
  }

  function create_fragment$3(ctx) {
  	let switch_instance_anchor;
  	let current;

  	const switch_instance_spread_levels = [
  		{
  			use: [
  				[
  					Ripple,
  					{
  						ripple: /*ripple*/ ctx[2],
  						unbounded: false,
  						classForward: /*func*/ ctx[18]
  					}
  				],
  				/*forwardEvents*/ ctx[11],
  				.../*use*/ ctx[0]
  			]
  		},
  		{
  			class: "\n    mdc-button\n    " + /*className*/ ctx[1] + "\n    " + /*rippleClasses*/ ctx[7].join(" ") + "\n    " + (/*variant*/ ctx[4] === "raised"
  			? "mdc-button--raised"
  			: "") + "\n    " + (/*variant*/ ctx[4] === "unelevated"
  			? "mdc-button--unelevated"
  			: "") + "\n    " + (/*variant*/ ctx[4] === "outlined"
  			? "mdc-button--outlined"
  			: "") + "\n    " + (/*dense*/ ctx[5] ? "mdc-button--dense" : "") + "\n    " + (/*color*/ ctx[3] === "secondary"
  			? "smui-button--color-secondary"
  			: "") + "\n    " + (/*context*/ ctx[12] === "card:action"
  			? "mdc-card__action"
  			: "") + "\n    " + (/*context*/ ctx[12] === "card:action"
  			? "mdc-card__action--button"
  			: "") + "\n    " + (/*context*/ ctx[12] === "dialog:action"
  			? "mdc-dialog__button"
  			: "") + "\n    " + (/*context*/ ctx[12] === "top-app-bar:navigation"
  			? "mdc-top-app-bar__navigation-icon"
  			: "") + "\n    " + (/*context*/ ctx[12] === "top-app-bar:action"
  			? "mdc-top-app-bar__action-item"
  			: "") + "\n    " + (/*context*/ ctx[12] === "snackbar"
  			? "mdc-snackbar__action"
  			: "") + "\n  "
  		},
  		/*actionProp*/ ctx[9],
  		/*defaultProp*/ ctx[10],
  		exclude(/*$$props*/ ctx[13], [
  			"use",
  			"class",
  			"ripple",
  			"color",
  			"variant",
  			"dense",
  			.../*dialogExcludes*/ ctx[8]
  		])
  	];

  	var switch_value = /*component*/ ctx[6];

  	function switch_props(ctx) {
  		let switch_instance_props = {
  			$$slots: { default: [create_default_slot] },
  			$$scope: { ctx }
  		};

  		for (let i = 0; i < switch_instance_spread_levels.length; i += 1) {
  			switch_instance_props = assign(switch_instance_props, switch_instance_spread_levels[i]);
  		}

  		return { props: switch_instance_props };
  	}

  	if (switch_value) {
  		var switch_instance = new switch_value(switch_props(ctx));
  	}

  	return {
  		c() {
  			if (switch_instance) create_component(switch_instance.$$.fragment);
  			switch_instance_anchor = empty();
  		},
  		m(target, anchor) {
  			if (switch_instance) {
  				mount_component(switch_instance, target, anchor);
  			}

  			insert(target, switch_instance_anchor, anchor);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const switch_instance_changes = (dirty & /*Ripple, ripple, rippleClasses, forwardEvents, use, className, variant, dense, color, context, actionProp, defaultProp, exclude, $$props, dialogExcludes*/ 16319)
  			? get_spread_update(switch_instance_spread_levels, [
  					dirty & /*Ripple, ripple, rippleClasses, forwardEvents, use*/ 2181 && {
  						use: [
  							[
  								Ripple,
  								{
  									ripple: /*ripple*/ ctx[2],
  									unbounded: false,
  									classForward: /*func*/ ctx[18]
  								}
  							],
  							/*forwardEvents*/ ctx[11],
  							.../*use*/ ctx[0]
  						]
  					},
  					dirty & /*className, rippleClasses, variant, dense, color, context*/ 4282 && {
  						class: "\n    mdc-button\n    " + /*className*/ ctx[1] + "\n    " + /*rippleClasses*/ ctx[7].join(" ") + "\n    " + (/*variant*/ ctx[4] === "raised"
  						? "mdc-button--raised"
  						: "") + "\n    " + (/*variant*/ ctx[4] === "unelevated"
  						? "mdc-button--unelevated"
  						: "") + "\n    " + (/*variant*/ ctx[4] === "outlined"
  						? "mdc-button--outlined"
  						: "") + "\n    " + (/*dense*/ ctx[5] ? "mdc-button--dense" : "") + "\n    " + (/*color*/ ctx[3] === "secondary"
  						? "smui-button--color-secondary"
  						: "") + "\n    " + (/*context*/ ctx[12] === "card:action"
  						? "mdc-card__action"
  						: "") + "\n    " + (/*context*/ ctx[12] === "card:action"
  						? "mdc-card__action--button"
  						: "") + "\n    " + (/*context*/ ctx[12] === "dialog:action"
  						? "mdc-dialog__button"
  						: "") + "\n    " + (/*context*/ ctx[12] === "top-app-bar:navigation"
  						? "mdc-top-app-bar__navigation-icon"
  						: "") + "\n    " + (/*context*/ ctx[12] === "top-app-bar:action"
  						? "mdc-top-app-bar__action-item"
  						: "") + "\n    " + (/*context*/ ctx[12] === "snackbar"
  						? "mdc-snackbar__action"
  						: "") + "\n  "
  					},
  					dirty & /*actionProp*/ 512 && get_spread_object(/*actionProp*/ ctx[9]),
  					dirty & /*defaultProp*/ 1024 && get_spread_object(/*defaultProp*/ ctx[10]),
  					dirty & /*exclude, $$props, dialogExcludes*/ 8448 && get_spread_object(exclude(/*$$props*/ ctx[13], [
  						"use",
  						"class",
  						"ripple",
  						"color",
  						"variant",
  						"dense",
  						.../*dialogExcludes*/ ctx[8]
  					]))
  				])
  			: {};

  			if (dirty & /*$$scope*/ 524288) {
  				switch_instance_changes.$$scope = { dirty, ctx };
  			}

  			if (switch_value !== (switch_value = /*component*/ ctx[6])) {
  				if (switch_instance) {
  					group_outros();
  					const old_component = switch_instance;

  					transition_out(old_component.$$.fragment, 1, 0, () => {
  						destroy_component(old_component, 1);
  					});

  					check_outros();
  				}

  				if (switch_value) {
  					switch_instance = new switch_value(switch_props(ctx));
  					create_component(switch_instance.$$.fragment);
  					transition_in(switch_instance.$$.fragment, 1);
  					mount_component(switch_instance, switch_instance_anchor.parentNode, switch_instance_anchor);
  				} else {
  					switch_instance = null;
  				}
  			} else if (switch_value) {
  				switch_instance.$set(switch_instance_changes);
  			}
  		},
  		i(local) {
  			if (current) return;
  			if (switch_instance) transition_in(switch_instance.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			if (switch_instance) transition_out(switch_instance.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(switch_instance_anchor);
  			if (switch_instance) destroy_component(switch_instance, detaching);
  		}
  	};
  }

  function instance$3($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { ripple = true } = $$props;
  	let { color = "primary" } = $$props;
  	let { variant = "text" } = $$props;
  	let { dense = false } = $$props;
  	let { href = null } = $$props;
  	let { action = "close" } = $$props;
  	let { default: defaultAction = false } = $$props;
  	let { component = href == null ? Button : A } = $$props;
  	let context = getContext("SMUI:button:context");
  	let rippleClasses = [];
  	setContext("SMUI:label:context", "button");
  	setContext("SMUI:icon:context", "button");
  	let { $$slots = {}, $$scope } = $$props;
  	const func = classes => $$invalidate(7, rippleClasses = classes);

  	$$self.$set = $$new_props => {
  		$$invalidate(13, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("ripple" in $$new_props) $$invalidate(2, ripple = $$new_props.ripple);
  		if ("color" in $$new_props) $$invalidate(3, color = $$new_props.color);
  		if ("variant" in $$new_props) $$invalidate(4, variant = $$new_props.variant);
  		if ("dense" in $$new_props) $$invalidate(5, dense = $$new_props.dense);
  		if ("href" in $$new_props) $$invalidate(14, href = $$new_props.href);
  		if ("action" in $$new_props) $$invalidate(15, action = $$new_props.action);
  		if ("default" in $$new_props) $$invalidate(16, defaultAction = $$new_props.default);
  		if ("component" in $$new_props) $$invalidate(6, component = $$new_props.component);
  		if ("$$scope" in $$new_props) $$invalidate(19, $$scope = $$new_props.$$scope);
  	};

  	let dialogExcludes;
  	let actionProp;
  	let defaultProp;

  	$$self.$$.update = () => {
  		if ($$self.$$.dirty & /*action*/ 32768) {
  			 $$invalidate(9, actionProp = context === "dialog:action" && action !== null
  			? { "data-mdc-dialog-action": action }
  			: {});
  		}

  		if ($$self.$$.dirty & /*defaultAction*/ 65536) {
  			 $$invalidate(10, defaultProp = context === "dialog:action" && defaultAction
  			? { "data-mdc-dialog-button-default": "" }
  			: {});
  		}
  	};

  	 $$invalidate(8, dialogExcludes = context === "dialog:action" ? ["action", "default"] : []);
  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		ripple,
  		color,
  		variant,
  		dense,
  		component,
  		rippleClasses,
  		dialogExcludes,
  		actionProp,
  		defaultProp,
  		forwardEvents,
  		context,
  		$$props,
  		href,
  		action,
  		defaultAction,
  		$$slots,
  		func,
  		$$scope
  	];
  }

  class Button_1 extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$3, create_fragment$3, safe_not_equal, {
  			use: 0,
  			class: 1,
  			ripple: 2,
  			color: 3,
  			variant: 4,
  			dense: 5,
  			href: 14,
  			action: 15,
  			default: 16,
  			component: 6
  		});
  	}
  }

  /* node_modules\@smui\common\Label.svelte generated by Svelte v3.18.1 */

  function create_fragment$4(ctx) {
  	let span;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[6].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[5], null);

  	let span_levels = [
  		{
  			class: "\n    " + /*className*/ ctx[1] + "\n    " + (/*context*/ ctx[3] === "button"
  			? "mdc-button__label"
  			: "") + "\n    " + (/*context*/ ctx[3] === "fab" ? "mdc-fab__label" : "") + "\n    " + (/*context*/ ctx[3] === "chip" ? "mdc-chip__text" : "") + "\n    " + (/*context*/ ctx[3] === "tab"
  			? "mdc-tab__text-label"
  			: "") + "\n    " + (/*context*/ ctx[3] === "image-list"
  			? "mdc-image-list__label"
  			: "") + "\n    " + (/*context*/ ctx[3] === "snackbar"
  			? "mdc-snackbar__label"
  			: "") + "\n  "
  		},
  		/*context*/ ctx[3] === "snackbar"
  		? { role: "status", "aria-live": "polite" }
  		: {},
  		exclude(/*$$props*/ ctx[4], ["use", "class"])
  	];

  	let span_data = {};

  	for (let i = 0; i < span_levels.length; i += 1) {
  		span_data = assign(span_data, span_levels[i]);
  	}

  	return {
  		c() {
  			span = element("span");
  			if (default_slot) default_slot.c();
  			set_attributes(span, span_data);
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);

  			if (default_slot) {
  				default_slot.m(span, null);
  			}

  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, span, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[2].call(null, span))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 32) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[5], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[5], dirty, null));
  			}

  			set_attributes(span, get_spread_update(span_levels, [
  				dirty & /*className, context*/ 10 && {
  					class: "\n    " + /*className*/ ctx[1] + "\n    " + (/*context*/ ctx[3] === "button"
  					? "mdc-button__label"
  					: "") + "\n    " + (/*context*/ ctx[3] === "fab" ? "mdc-fab__label" : "") + "\n    " + (/*context*/ ctx[3] === "chip" ? "mdc-chip__text" : "") + "\n    " + (/*context*/ ctx[3] === "tab"
  					? "mdc-tab__text-label"
  					: "") + "\n    " + (/*context*/ ctx[3] === "image-list"
  					? "mdc-image-list__label"
  					: "") + "\n    " + (/*context*/ ctx[3] === "snackbar"
  					? "mdc-snackbar__label"
  					: "") + "\n  "
  				},
  				dirty & /*context*/ 8 && (/*context*/ ctx[3] === "snackbar"
  				? { role: "status", "aria-live": "polite" }
  				: {}),
  				dirty & /*exclude, $$props*/ 16 && exclude(/*$$props*/ ctx[4], ["use", "class"])
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(span);
  			if (default_slot) default_slot.d(detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance$4($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	const context = getContext("SMUI:label:context");
  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(4, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("$$scope" in $$new_props) $$invalidate(5, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);
  	return [use, className, forwardEvents, context, $$props, $$scope, $$slots];
  }

  class Label extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$4, create_fragment$4, safe_not_equal, { use: 0, class: 1 });
  	}
  }

  /* node_modules\@smui\common\Icon.svelte generated by Svelte v3.18.1 */

  function create_fragment$5(ctx) {
  	let i;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[10].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[9], null);

  	let i_levels = [
  		{
  			class: "\n    " + /*className*/ ctx[1] + "\n    " + (/*context*/ ctx[7] === "button"
  			? "mdc-button__icon"
  			: "") + "\n    " + (/*context*/ ctx[7] === "fab" ? "mdc-fab__icon" : "") + "\n    " + (/*context*/ ctx[7] === "icon-button"
  			? "mdc-icon-button__icon"
  			: "") + "\n    " + (/*context*/ ctx[7] === "icon-button" && /*on*/ ctx[2]
  			? "mdc-icon-button__icon--on"
  			: "") + "\n    " + (/*context*/ ctx[7] === "chip" ? "mdc-chip__icon" : "") + "\n    " + (/*context*/ ctx[7] === "chip" && /*leading*/ ctx[3]
  			? "mdc-chip__icon--leading"
  			: "") + "\n    " + (/*context*/ ctx[7] === "chip" && /*leadingHidden*/ ctx[4]
  			? "mdc-chip__icon--leading-hidden"
  			: "") + "\n    " + (/*context*/ ctx[7] === "chip" && /*trailing*/ ctx[5]
  			? "mdc-chip__icon--trailing"
  			: "") + "\n    " + (/*context*/ ctx[7] === "tab" ? "mdc-tab__icon" : "") + "\n  "
  		},
  		{ "aria-hidden": "true" },
  		exclude(/*$$props*/ ctx[8], ["use", "class", "on", "leading", "leadingHidden", "trailing"])
  	];

  	let i_data = {};

  	for (let i = 0; i < i_levels.length; i += 1) {
  		i_data = assign(i_data, i_levels[i]);
  	}

  	return {
  		c() {
  			i = element("i");
  			if (default_slot) default_slot.c();
  			set_attributes(i, i_data);
  		},
  		m(target, anchor) {
  			insert(target, i, anchor);

  			if (default_slot) {
  				default_slot.m(i, null);
  			}

  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, i, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[6].call(null, i))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 512) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[9], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[9], dirty, null));
  			}

  			set_attributes(i, get_spread_update(i_levels, [
  				dirty & /*className, context, on, leading, leadingHidden, trailing*/ 190 && {
  					class: "\n    " + /*className*/ ctx[1] + "\n    " + (/*context*/ ctx[7] === "button"
  					? "mdc-button__icon"
  					: "") + "\n    " + (/*context*/ ctx[7] === "fab" ? "mdc-fab__icon" : "") + "\n    " + (/*context*/ ctx[7] === "icon-button"
  					? "mdc-icon-button__icon"
  					: "") + "\n    " + (/*context*/ ctx[7] === "icon-button" && /*on*/ ctx[2]
  					? "mdc-icon-button__icon--on"
  					: "") + "\n    " + (/*context*/ ctx[7] === "chip" ? "mdc-chip__icon" : "") + "\n    " + (/*context*/ ctx[7] === "chip" && /*leading*/ ctx[3]
  					? "mdc-chip__icon--leading"
  					: "") + "\n    " + (/*context*/ ctx[7] === "chip" && /*leadingHidden*/ ctx[4]
  					? "mdc-chip__icon--leading-hidden"
  					: "") + "\n    " + (/*context*/ ctx[7] === "chip" && /*trailing*/ ctx[5]
  					? "mdc-chip__icon--trailing"
  					: "") + "\n    " + (/*context*/ ctx[7] === "tab" ? "mdc-tab__icon" : "") + "\n  "
  				},
  				{ "aria-hidden": "true" },
  				dirty & /*exclude, $$props*/ 256 && exclude(/*$$props*/ ctx[8], ["use", "class", "on", "leading", "leadingHidden", "trailing"])
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(i);
  			if (default_slot) default_slot.d(detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance$5($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { on = false } = $$props;
  	let { leading = false } = $$props;
  	let { leadingHidden = false } = $$props;
  	let { trailing = false } = $$props;
  	const context = getContext("SMUI:icon:context");
  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(8, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("on" in $$new_props) $$invalidate(2, on = $$new_props.on);
  		if ("leading" in $$new_props) $$invalidate(3, leading = $$new_props.leading);
  		if ("leadingHidden" in $$new_props) $$invalidate(4, leadingHidden = $$new_props.leadingHidden);
  		if ("trailing" in $$new_props) $$invalidate(5, trailing = $$new_props.trailing);
  		if ("$$scope" in $$new_props) $$invalidate(9, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		on,
  		leading,
  		leadingHidden,
  		trailing,
  		forwardEvents,
  		context,
  		$$props,
  		$$scope,
  		$$slots
  	];
  }

  class Icon extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$5, create_fragment$5, safe_not_equal, {
  			use: 0,
  			class: 1,
  			on: 2,
  			leading: 3,
  			leadingHidden: 4,
  			trailing: 5
  		});
  	}
  }

  /* Counter.svelte generated by Svelte v3.18.1 */

  function create_default_slot_3(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("thumb_up");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (18:6) <Label>
  function create_default_slot_2(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("Click Me");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (16:4) <Button on:click={() => clicked++}>
  function create_default_slot_1(ctx) {
  	let t;
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_3] },
  				$$scope: { ctx }
  			}
  		});

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_2] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(icon.$$.fragment);
  			t = space();
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(icon, target, anchor);
  			insert(target, t, anchor);
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const icon_changes = {};

  			if (dirty & /*$$scope*/ 4) {
  				icon_changes.$$scope = { dirty, ctx };
  			}

  			icon.$set(icon_changes);
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 4) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(icon.$$.fragment, local);
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(icon.$$.fragment, local);
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(icon, detaching);
  			if (detaching) detach(t);
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (23:6) {:else}
  function create_else_block(ctx) {
  	let span;

  	return {
  		c() {
  			span = element("span");
  			span.textContent = "You haven't clicked the button.";
  			attr(span, "class", "grayed");
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);
  		},
  		p: noop,
  		d(detaching) {
  			if (detaching) detach(span);
  		}
  	};
  }

  // (21:6) {#if clicked}
  function create_if_block(ctx) {
  	let t0;
  	let t1;
  	let t2;
  	let t3_value = (/*clicked*/ ctx[0] === 1 ? "" : "s") + "";
  	let t3;
  	let t4;

  	return {
  		c() {
  			t0 = text("You've clicked the button ");
  			t1 = text(/*clicked*/ ctx[0]);
  			t2 = text(" time");
  			t3 = text(t3_value);
  			t4 = text(".");
  		},
  		m(target, anchor) {
  			insert(target, t0, anchor);
  			insert(target, t1, anchor);
  			insert(target, t2, anchor);
  			insert(target, t3, anchor);
  			insert(target, t4, anchor);
  		},
  		p(ctx, dirty) {
  			if (dirty & /*clicked*/ 1) set_data(t1, /*clicked*/ ctx[0]);
  			if (dirty & /*clicked*/ 1 && t3_value !== (t3_value = (/*clicked*/ ctx[0] === 1 ? "" : "s") + "")) set_data(t3, t3_value);
  		},
  		d(detaching) {
  			if (detaching) detach(t0);
  			if (detaching) detach(t1);
  			if (detaching) detach(t2);
  			if (detaching) detach(t3);
  			if (detaching) detach(t4);
  		}
  	};
  }

  // (15:4) <Card style="width: 360px;">
  function create_default_slot$1(ctx) {
  	let t;
  	let p;
  	let current;

  	const button = new Button_1({
  			props: {
  				$$slots: { default: [create_default_slot_1] },
  				$$scope: { ctx }
  			}
  		});

  	button.$on("click", /*click_handler*/ ctx[1]);

  	function select_block_type(ctx, dirty) {
  		if (/*clicked*/ ctx[0]) return create_if_block;
  		return create_else_block;
  	}

  	let current_block_type = select_block_type(ctx);
  	let if_block = current_block_type(ctx);

  	return {
  		c() {
  			create_component(button.$$.fragment);
  			t = space();
  			p = element("p");
  			if_block.c();
  			attr(p, "class", "mdc-typography--body1");
  		},
  		m(target, anchor) {
  			mount_component(button, target, anchor);
  			insert(target, t, anchor);
  			insert(target, p, anchor);
  			if_block.m(p, null);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const button_changes = {};

  			if (dirty & /*$$scope*/ 4) {
  				button_changes.$$scope = { dirty, ctx };
  			}

  			button.$set(button_changes);

  			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
  				if_block.p(ctx, dirty);
  			} else {
  				if_block.d(1);
  				if_block = current_block_type(ctx);

  				if (if_block) {
  					if_block.c();
  					if_block.m(p, null);
  				}
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(button.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(button.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(button, detaching);
  			if (detaching) detach(t);
  			if (detaching) detach(p);
  			if_block.d();
  		}
  	};
  }

  function create_fragment$6(ctx) {
  	let div;
  	let current;

  	const card = new Card({
  			props: {
  				style: "width: 360px;",
  				$$slots: { default: [create_default_slot$1] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			div = element("div");
  			create_component(card.$$.fragment);
  			attr(div, "class", "container");
  		},
  		m(target, anchor) {
  			insert(target, div, anchor);
  			mount_component(card, div, null);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const card_changes = {};

  			if (dirty & /*$$scope, clicked*/ 5) {
  				card_changes.$$scope = { dirty, ctx };
  			}

  			card.$set(card_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(card.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(card.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div);
  			destroy_component(card);
  		}
  	};
  }

  function instance$6($$self, $$props, $$invalidate) {
  	let clicked = 0;
  	const click_handler = () => $$invalidate(0, clicked++, clicked);
  	return [clicked, click_handler];
  }

  class Counter extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$6, create_fragment$6, safe_not_equal, {});
  	}
  }

  /**
   * @license
   * Copyright 2018 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  /** CSS classes used by the switch. */
  var cssClasses$1 = {
      /** Class used for a switch that is in the "checked" (on) position. */
      CHECKED: 'mdc-switch--checked',
      /** Class used for a switch that is disabled. */
      DISABLED: 'mdc-switch--disabled',
  };
  /** String constants used by the switch. */
  var strings$1 = {
      /** A CSS selector used to locate the native HTML control for the switch.  */
      NATIVE_CONTROL_SELECTOR: '.mdc-switch__native-control',
      /** A CSS selector used to locate the ripple surface element for the switch. */
      RIPPLE_SURFACE_SELECTOR: '.mdc-switch__thumb-underlay',
  };

  /**
   * @license
   * Copyright 2018 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var MDCSwitchFoundation = /** @class */ (function (_super) {
      __extends(MDCSwitchFoundation, _super);
      function MDCSwitchFoundation(adapter) {
          return _super.call(this, __assign({}, MDCSwitchFoundation.defaultAdapter, adapter)) || this;
      }
      Object.defineProperty(MDCSwitchFoundation, "strings", {
          /** The string constants used by the switch. */
          get: function () {
              return strings$1;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCSwitchFoundation, "cssClasses", {
          /** The CSS classes used by the switch. */
          get: function () {
              return cssClasses$1;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCSwitchFoundation, "defaultAdapter", {
          /** The default Adapter for the switch. */
          get: function () {
              return {
                  addClass: function () { return undefined; },
                  removeClass: function () { return undefined; },
                  setNativeControlChecked: function () { return undefined; },
                  setNativeControlDisabled: function () { return undefined; },
              };
          },
          enumerable: true,
          configurable: true
      });
      /** Sets the checked state of the switch. */
      MDCSwitchFoundation.prototype.setChecked = function (checked) {
          this.adapter_.setNativeControlChecked(checked);
          this.updateCheckedStyling_(checked);
      };
      /** Sets the disabled state of the switch. */
      MDCSwitchFoundation.prototype.setDisabled = function (disabled) {
          this.adapter_.setNativeControlDisabled(disabled);
          if (disabled) {
              this.adapter_.addClass(cssClasses$1.DISABLED);
          }
          else {
              this.adapter_.removeClass(cssClasses$1.DISABLED);
          }
      };
      /** Handles the change event for the switch native control. */
      MDCSwitchFoundation.prototype.handleChange = function (evt) {
          var nativeControl = evt.target;
          this.updateCheckedStyling_(nativeControl.checked);
      };
      /** Updates the styling of the switch based on its checked state. */
      MDCSwitchFoundation.prototype.updateCheckedStyling_ = function (checked) {
          if (checked) {
              this.adapter_.addClass(cssClasses$1.CHECKED);
          }
          else {
              this.adapter_.removeClass(cssClasses$1.CHECKED);
          }
      };
      return MDCSwitchFoundation;
  }(MDCFoundation));

  /**
   * @license
   * Copyright 2018 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var MDCSwitch = /** @class */ (function (_super) {
      __extends(MDCSwitch, _super);
      function MDCSwitch() {
          var _this = _super !== null && _super.apply(this, arguments) || this;
          _this.ripple_ = _this.createRipple_();
          return _this;
      }
      MDCSwitch.attachTo = function (root) {
          return new MDCSwitch(root);
      };
      MDCSwitch.prototype.destroy = function () {
          _super.prototype.destroy.call(this);
          this.ripple_.destroy();
          this.nativeControl_.removeEventListener('change', this.changeHandler_);
      };
      MDCSwitch.prototype.initialSyncWithDOM = function () {
          var _this = this;
          this.changeHandler_ = function () {
              var _a;
              var args = [];
              for (var _i = 0; _i < arguments.length; _i++) {
                  args[_i] = arguments[_i];
              }
              return (_a = _this.foundation_).handleChange.apply(_a, __spread(args));
          };
          this.nativeControl_.addEventListener('change', this.changeHandler_);
          // Sometimes the checked state of the input element is saved in the history.
          // The switch styling should match the checked state of the input element.
          // Do an initial sync between the native control and the foundation.
          this.checked = this.checked;
      };
      MDCSwitch.prototype.getDefaultFoundation = function () {
          var _this = this;
          // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
          // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
          var adapter = {
              addClass: function (className) { return _this.root_.classList.add(className); },
              removeClass: function (className) { return _this.root_.classList.remove(className); },
              setNativeControlChecked: function (checked) { return _this.nativeControl_.checked = checked; },
              setNativeControlDisabled: function (disabled) { return _this.nativeControl_.disabled = disabled; },
          };
          return new MDCSwitchFoundation(adapter);
      };
      Object.defineProperty(MDCSwitch.prototype, "ripple", {
          get: function () {
              return this.ripple_;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCSwitch.prototype, "checked", {
          get: function () {
              return this.nativeControl_.checked;
          },
          set: function (checked) {
              this.foundation_.setChecked(checked);
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCSwitch.prototype, "disabled", {
          get: function () {
              return this.nativeControl_.disabled;
          },
          set: function (disabled) {
              this.foundation_.setDisabled(disabled);
          },
          enumerable: true,
          configurable: true
      });
      MDCSwitch.prototype.createRipple_ = function () {
          var _this = this;
          var RIPPLE_SURFACE_SELECTOR = MDCSwitchFoundation.strings.RIPPLE_SURFACE_SELECTOR;
          var rippleSurface = this.root_.querySelector(RIPPLE_SURFACE_SELECTOR);
          // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
          // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
          var adapter = __assign({}, MDCRipple.createAdapter(this), { addClass: function (className) { return rippleSurface.classList.add(className); }, computeBoundingRect: function () { return rippleSurface.getBoundingClientRect(); }, deregisterInteractionHandler: function (evtType, handler) {
                  _this.nativeControl_.removeEventListener(evtType, handler, applyPassive());
              }, isSurfaceActive: function () { return matches(_this.nativeControl_, ':active'); }, isUnbounded: function () { return true; }, registerInteractionHandler: function (evtType, handler) {
                  _this.nativeControl_.addEventListener(evtType, handler, applyPassive());
              }, removeClass: function (className) { return rippleSurface.classList.remove(className); }, updateCssVariable: function (varName, value) {
                  rippleSurface.style.setProperty(varName, value);
              } });
          return new MDCRipple(this.root_, new MDCRippleFoundation(adapter));
      };
      Object.defineProperty(MDCSwitch.prototype, "nativeControl_", {
          get: function () {
              var NATIVE_CONTROL_SELECTOR = MDCSwitchFoundation.strings.NATIVE_CONTROL_SELECTOR;
              return this.root_.querySelector(NATIVE_CONTROL_SELECTOR);
          },
          enumerable: true,
          configurable: true
      });
      return MDCSwitch;
  }(MDCComponent));

  function prefixFilter(obj, prefix) {
    let names = Object.getOwnPropertyNames(obj);
    const newObj = {};

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (name.substring(0, prefix.length) === prefix) {
        newObj[name.substring(prefix.length)] = obj[name];
      }
    }

    return newObj;
  }

  /* node_modules\@smui\switch\Switch.svelte generated by Svelte v3.18.1 */

  function create_fragment$7(ctx) {
  	let div3;
  	let div0;
  	let t;
  	let div2;
  	let div1;
  	let input;
  	let useActions_action;
  	let useActions_action_1;
  	let forwardEvents_action;
  	let dispose;

  	let input_levels = [
  		exclude(prefixFilter(/*$$props*/ ctx[13], "input$"), ["use", "class"]),
  		{ type: "checkbox" },
  		{ role: "switch" },
  		/*inputProps*/ ctx[11],
  		{ disabled: /*disabled*/ ctx[2] },
  		{
  			class: "mdc-switch__native-control " + /*input$class*/ ctx[6]
  		},
  		{
  			value: /*valueKey*/ ctx[4] === /*uninitializedValue*/ ctx[10]
  			? /*value*/ ctx[3]
  			: /*valueKey*/ ctx[4]
  		}
  	];

  	let input_data = {};

  	for (let i = 0; i < input_levels.length; i += 1) {
  		input_data = assign(input_data, input_levels[i]);
  	}

  	let div3_levels = [
  		{
  			class: "\n    mdc-switch\n    " + /*className*/ ctx[1] + "\n    " + (/*disabled*/ ctx[2] ? "mdc-switch--disabled" : "") + "\n    " + (/*nativeChecked*/ ctx[8] ? "mdc-switch--checked" : "") + "\n  "
  		},
  		exclude(/*$$props*/ ctx[13], ["use", "class", "disabled", "group", "checked", "value", "input$"])
  	];

  	let div3_data = {};

  	for (let i = 0; i < div3_levels.length; i += 1) {
  		div3_data = assign(div3_data, div3_levels[i]);
  	}

  	return {
  		c() {
  			div3 = element("div");
  			div0 = element("div");
  			t = space();
  			div2 = element("div");
  			div1 = element("div");
  			input = element("input");
  			attr(div0, "class", "mdc-switch__track");
  			set_attributes(input, input_data);
  			attr(div1, "class", "mdc-switch__thumb");
  			attr(div2, "class", "mdc-switch__thumb-underlay");
  			set_attributes(div3, div3_data);
  		},
  		m(target, anchor) {
  			insert(target, div3, anchor);
  			append(div3, div0);
  			append(div3, t);
  			append(div3, div2);
  			append(div2, div1);
  			append(div1, input);
  			input.checked = /*nativeChecked*/ ctx[8];
  			/*div3_binding*/ ctx[24](div3);

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, input, /*input$use*/ ctx[5])),
  				listen(input, "change", /*input_change_handler*/ ctx[23]),
  				listen(input, "change", /*handleChange*/ ctx[12]),
  				listen(input, "change", /*change_handler*/ ctx[21]),
  				listen(input, "input", /*input_handler*/ ctx[22]),
  				action_destroyer(useActions_action_1 = useActions.call(null, div3, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[9].call(null, div3))
  			];
  		},
  		p(ctx, [dirty]) {
  			set_attributes(input, get_spread_update(input_levels, [
  				dirty & /*exclude, prefixFilter, $$props*/ 8192 && exclude(prefixFilter(/*$$props*/ ctx[13], "input$"), ["use", "class"]),
  				{ type: "checkbox" },
  				{ role: "switch" },
  				dirty & /*inputProps*/ 2048 && /*inputProps*/ ctx[11],
  				dirty & /*disabled*/ 4 && { disabled: /*disabled*/ ctx[2] },
  				dirty & /*input$class*/ 64 && {
  					class: "mdc-switch__native-control " + /*input$class*/ ctx[6]
  				},
  				dirty & /*valueKey, uninitializedValue, value*/ 1048 && {
  					value: /*valueKey*/ ctx[4] === /*uninitializedValue*/ ctx[10]
  					? /*value*/ ctx[3]
  					: /*valueKey*/ ctx[4]
  				}
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*input$use*/ 32) useActions_action.update.call(null, /*input$use*/ ctx[5]);

  			if (dirty & /*nativeChecked*/ 256) {
  				input.checked = /*nativeChecked*/ ctx[8];
  			}

  			set_attributes(div3, get_spread_update(div3_levels, [
  				dirty & /*className, disabled, nativeChecked*/ 262 && {
  					class: "\n    mdc-switch\n    " + /*className*/ ctx[1] + "\n    " + (/*disabled*/ ctx[2] ? "mdc-switch--disabled" : "") + "\n    " + (/*nativeChecked*/ ctx[8] ? "mdc-switch--checked" : "") + "\n  "
  				},
  				dirty & /*exclude, $$props*/ 8192 && exclude(/*$$props*/ ctx[13], ["use", "class", "disabled", "group", "checked", "value", "input$"])
  			]));

  			if (useActions_action_1 && is_function(useActions_action_1.update) && dirty & /*use*/ 1) useActions_action_1.update.call(null, /*use*/ ctx[0]);
  		},
  		i: noop,
  		o: noop,
  		d(detaching) {
  			if (detaching) detach(div3);
  			/*div3_binding*/ ctx[24](null);
  			run_all(dispose);
  		}
  	};
  }

  function instance$7($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);

  	let uninitializedValue = () => {
  		
  	};

  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { disabled = false } = $$props;
  	let { group = uninitializedValue } = $$props;
  	let { checked = uninitializedValue } = $$props;
  	let { value = null } = $$props;
  	let { valueKey = uninitializedValue } = $$props;
  	let { input$use = [] } = $$props;
  	let { input$class = "" } = $$props;
  	let element;
  	let switchControl;
  	let formField = getContext("SMUI:form-field");
  	let inputProps = getContext("SMUI:generic:input:props") || {};
  	let setChecked = getContext("SMUI:generic:input:setChecked");

  	let nativeChecked = group === uninitializedValue
  	? checked === uninitializedValue ? false : checked
  	: group.indexOf(value) !== -1;

  	let previousChecked = checked;

  	onMount(() => {
  		$$invalidate(17, switchControl = new MDCSwitch(element));

  		if (formField && formField()) {
  			formField().input = switchControl;
  		}
  	});

  	onDestroy(() => {
  		switchControl && switchControl.destroy();
  	});

  	function handleChange(e) {
  		if (group !== uninitializedValue) {
  			const idx = group.indexOf(value);

  			if (switchControl.checked && idx === -1) {
  				group.push(value);
  				$$invalidate(14, group);
  			} else if (!switchControl.checked && idx !== -1) {
  				group.splice(idx, 1);
  				$$invalidate(14, group);
  			}
  		}
  	}

  	function getId() {
  		return inputProps && inputProps.id;
  	}

  	function change_handler(event) {
  		bubble($$self, event);
  	}

  	function input_handler(event) {
  		bubble($$self, event);
  	}

  	function input_change_handler() {
  		nativeChecked = this.checked;
  		((($$invalidate(8, nativeChecked), $$invalidate(15, checked)), $$invalidate(10, uninitializedValue)), $$invalidate(18, previousChecked));
  	}

  	function div3_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(7, element = $$value);
  		});
  	}

  	$$self.$set = $$new_props => {
  		$$invalidate(13, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("disabled" in $$new_props) $$invalidate(2, disabled = $$new_props.disabled);
  		if ("group" in $$new_props) $$invalidate(14, group = $$new_props.group);
  		if ("checked" in $$new_props) $$invalidate(15, checked = $$new_props.checked);
  		if ("value" in $$new_props) $$invalidate(3, value = $$new_props.value);
  		if ("valueKey" in $$new_props) $$invalidate(4, valueKey = $$new_props.valueKey);
  		if ("input$use" in $$new_props) $$invalidate(5, input$use = $$new_props.input$use);
  		if ("input$class" in $$new_props) $$invalidate(6, input$class = $$new_props.input$class);
  	};

  	$$self.$$.update = () => {
  		if ($$self.$$.dirty & /*checked, previousChecked, nativeChecked*/ 295168) {
  			 if (checked !== uninitializedValue) {
  				if (checked === previousChecked) {
  					$$invalidate(15, checked = nativeChecked);
  				} else if (nativeChecked !== checked) {
  					$$invalidate(8, nativeChecked = checked);
  				}

  				$$invalidate(18, previousChecked = checked);
  			}
  		}

  		if ($$self.$$.dirty & /*nativeChecked*/ 256) {
  			 if (setChecked) {
  				setChecked(nativeChecked);
  			}
  		}

  		if ($$self.$$.dirty & /*switchControl, group, value, checked*/ 180232) {
  			 if (switchControl) {
  				if (group !== uninitializedValue) {
  					const isChecked = group.indexOf(value) !== -1;

  					if (switchControl.checked !== isChecked) {
  						$$invalidate(17, switchControl.checked = isChecked, switchControl);
  					}
  				} else if (checked !== uninitializedValue && switchControl.checked !== checked) {
  					$$invalidate(17, switchControl.checked = checked, switchControl);
  				}
  			}
  		}

  		if ($$self.$$.dirty & /*switchControl, disabled*/ 131076) {
  			 if (switchControl && switchControl.disabled !== disabled) {
  				$$invalidate(17, switchControl.disabled = disabled, switchControl);
  			}
  		}

  		if ($$self.$$.dirty & /*switchControl, valueKey, value*/ 131096) {
  			 if (switchControl && valueKey === uninitializedValue && switchControl.value !== value) {
  				$$invalidate(17, switchControl.value = value, switchControl);
  			}
  		}

  		if ($$self.$$.dirty & /*switchControl, valueKey*/ 131088) {
  			 if (switchControl && valueKey !== uninitializedValue && switchControl.value !== valueKey) {
  				$$invalidate(17, switchControl.value = valueKey, switchControl);
  			}
  		}
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		disabled,
  		value,
  		valueKey,
  		input$use,
  		input$class,
  		element,
  		nativeChecked,
  		forwardEvents,
  		uninitializedValue,
  		inputProps,
  		handleChange,
  		$$props,
  		group,
  		checked,
  		getId,
  		switchControl,
  		previousChecked,
  		formField,
  		setChecked,
  		change_handler,
  		input_handler,
  		input_change_handler,
  		div3_binding
  	];
  }

  class Switch extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$7, create_fragment$7, safe_not_equal, {
  			use: 0,
  			class: 1,
  			disabled: 2,
  			group: 14,
  			checked: 15,
  			value: 3,
  			valueKey: 4,
  			input$use: 5,
  			input$class: 6,
  			getId: 16
  		});
  	}

  	get getId() {
  		return this.$$.ctx[16];
  	}
  }

  /**
   * @license
   * Copyright 2017 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var cssClasses$2 = {
      ROOT: 'mdc-form-field',
  };
  var strings$2 = {
      LABEL_SELECTOR: '.mdc-form-field > label',
  };

  /**
   * @license
   * Copyright 2017 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var MDCFormFieldFoundation = /** @class */ (function (_super) {
      __extends(MDCFormFieldFoundation, _super);
      function MDCFormFieldFoundation(adapter) {
          var _this = _super.call(this, __assign({}, MDCFormFieldFoundation.defaultAdapter, adapter)) || this;
          _this.clickHandler_ = function () { return _this.handleClick_(); };
          return _this;
      }
      Object.defineProperty(MDCFormFieldFoundation, "cssClasses", {
          get: function () {
              return cssClasses$2;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCFormFieldFoundation, "strings", {
          get: function () {
              return strings$2;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCFormFieldFoundation, "defaultAdapter", {
          get: function () {
              return {
                  activateInputRipple: function () { return undefined; },
                  deactivateInputRipple: function () { return undefined; },
                  deregisterInteractionHandler: function () { return undefined; },
                  registerInteractionHandler: function () { return undefined; },
              };
          },
          enumerable: true,
          configurable: true
      });
      MDCFormFieldFoundation.prototype.init = function () {
          this.adapter_.registerInteractionHandler('click', this.clickHandler_);
      };
      MDCFormFieldFoundation.prototype.destroy = function () {
          this.adapter_.deregisterInteractionHandler('click', this.clickHandler_);
      };
      MDCFormFieldFoundation.prototype.handleClick_ = function () {
          var _this = this;
          this.adapter_.activateInputRipple();
          requestAnimationFrame(function () { return _this.adapter_.deactivateInputRipple(); });
      };
      return MDCFormFieldFoundation;
  }(MDCFoundation));

  /**
   * @license
   * Copyright 2017 Google Inc.
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */
  var MDCFormField = /** @class */ (function (_super) {
      __extends(MDCFormField, _super);
      function MDCFormField() {
          return _super !== null && _super.apply(this, arguments) || this;
      }
      MDCFormField.attachTo = function (root) {
          return new MDCFormField(root);
      };
      Object.defineProperty(MDCFormField.prototype, "input", {
          get: function () {
              return this.input_;
          },
          set: function (input) {
              this.input_ = input;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCFormField.prototype, "label_", {
          get: function () {
              var LABEL_SELECTOR = MDCFormFieldFoundation.strings.LABEL_SELECTOR;
              return this.root_.querySelector(LABEL_SELECTOR);
          },
          enumerable: true,
          configurable: true
      });
      MDCFormField.prototype.getDefaultFoundation = function () {
          var _this = this;
          // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
          // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
          var adapter = {
              activateInputRipple: function () {
                  if (_this.input_ && _this.input_.ripple) {
                      _this.input_.ripple.activate();
                  }
              },
              deactivateInputRipple: function () {
                  if (_this.input_ && _this.input_.ripple) {
                      _this.input_.ripple.deactivate();
                  }
              },
              deregisterInteractionHandler: function (evtType, handler) {
                  if (_this.label_) {
                      _this.label_.removeEventListener(evtType, handler);
                  }
              },
              registerInteractionHandler: function (evtType, handler) {
                  if (_this.label_) {
                      _this.label_.addEventListener(evtType, handler);
                  }
              },
          };
          return new MDCFormFieldFoundation(adapter);
      };
      return MDCFormField;
  }(MDCComponent));

  /* node_modules\@smui\form-field\FormField.svelte generated by Svelte v3.18.1 */
  const get_label_slot_changes = dirty => ({});
  const get_label_slot_context = ctx => ({});

  function create_fragment$8(ctx) {
  	let div;
  	let t;
  	let label;
  	let useActions_action;
  	let useActions_action_1;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[10].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[9], null);
  	const label_slot_template = /*$$slots*/ ctx[10].label;
  	const label_slot = create_slot(label_slot_template, ctx, /*$$scope*/ ctx[9], get_label_slot_context);

  	let label_levels = [
  		{ for: /*inputId*/ ctx[3] },
  		exclude(prefixFilter(/*$$props*/ ctx[7], "label$"), ["use"])
  	];

  	let label_data = {};

  	for (let i = 0; i < label_levels.length; i += 1) {
  		label_data = assign(label_data, label_levels[i]);
  	}

  	let div_levels = [
  		{
  			class: "\n    mdc-form-field\n    " + /*className*/ ctx[1] + "\n    " + (/*align*/ ctx[2] === "end"
  			? "mdc-form-field--align-end"
  			: "") + "\n  "
  		},
  		exclude(/*$$props*/ ctx[7], ["use", "class", "alignEnd", "inputId", "label$"])
  	];

  	let div_data = {};

  	for (let i = 0; i < div_levels.length; i += 1) {
  		div_data = assign(div_data, div_levels[i]);
  	}

  	return {
  		c() {
  			div = element("div");
  			if (default_slot) default_slot.c();
  			t = space();
  			label = element("label");
  			if (label_slot) label_slot.c();
  			set_attributes(label, label_data);
  			set_attributes(div, div_data);
  		},
  		m(target, anchor) {
  			insert(target, div, anchor);

  			if (default_slot) {
  				default_slot.m(div, null);
  			}

  			append(div, t);
  			append(div, label);

  			if (label_slot) {
  				label_slot.m(label, null);
  			}

  			/*div_binding*/ ctx[11](div);
  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, label, /*label$use*/ ctx[4])),
  				action_destroyer(useActions_action_1 = useActions.call(null, div, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[6].call(null, div))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 512) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[9], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[9], dirty, null));
  			}

  			if (label_slot && label_slot.p && dirty & /*$$scope*/ 512) {
  				label_slot.p(get_slot_context(label_slot_template, ctx, /*$$scope*/ ctx[9], get_label_slot_context), get_slot_changes(label_slot_template, /*$$scope*/ ctx[9], dirty, get_label_slot_changes));
  			}

  			set_attributes(label, get_spread_update(label_levels, [
  				dirty & /*inputId*/ 8 && { for: /*inputId*/ ctx[3] },
  				dirty & /*exclude, prefixFilter, $$props*/ 128 && exclude(prefixFilter(/*$$props*/ ctx[7], "label$"), ["use"])
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*label$use*/ 16) useActions_action.update.call(null, /*label$use*/ ctx[4]);

  			set_attributes(div, get_spread_update(div_levels, [
  				dirty & /*className, align*/ 6 && {
  					class: "\n    mdc-form-field\n    " + /*className*/ ctx[1] + "\n    " + (/*align*/ ctx[2] === "end"
  					? "mdc-form-field--align-end"
  					: "") + "\n  "
  				},
  				dirty & /*exclude, $$props*/ 128 && exclude(/*$$props*/ ctx[7], ["use", "class", "alignEnd", "inputId", "label$"])
  			]));

  			if (useActions_action_1 && is_function(useActions_action_1.update) && dirty & /*use*/ 1) useActions_action_1.update.call(null, /*use*/ ctx[0]);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			transition_in(label_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			transition_out(label_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div);
  			if (default_slot) default_slot.d(detaching);
  			if (label_slot) label_slot.d(detaching);
  			/*div_binding*/ ctx[11](null);
  			run_all(dispose);
  		}
  	};
  }

  let counter = 0;

  function instance$8($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { align = "start" } = $$props;
  	let { inputId = "SMUI-form-field-" + counter++ } = $$props;
  	let { label$use = [] } = $$props;
  	let element;
  	let formField;
  	setContext("SMUI:form-field", () => formField);
  	setContext("SMUI:generic:input:props", { id: inputId });

  	onMount(() => {
  		formField = new MDCFormField(element);
  	});

  	onDestroy(() => {
  		formField && formField.destroy();
  	});

  	let { $$slots = {}, $$scope } = $$props;

  	function div_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(5, element = $$value);
  		});
  	}

  	$$self.$set = $$new_props => {
  		$$invalidate(7, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("align" in $$new_props) $$invalidate(2, align = $$new_props.align);
  		if ("inputId" in $$new_props) $$invalidate(3, inputId = $$new_props.inputId);
  		if ("label$use" in $$new_props) $$invalidate(4, label$use = $$new_props.label$use);
  		if ("$$scope" in $$new_props) $$invalidate(9, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		align,
  		inputId,
  		label$use,
  		element,
  		forwardEvents,
  		$$props,
  		formField,
  		$$scope,
  		$$slots,
  		div_binding
  	];
  }

  class FormField extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$8, create_fragment$8, safe_not_equal, {
  			use: 0,
  			class: 1,
  			align: 2,
  			inputId: 3,
  			label$use: 4
  		});
  	}
  }

  /* switcher.svelte generated by Svelte v3.18.1 */

  function create_label_slot(ctx) {
  	let span;
  	let t_value = (/*selected*/ ctx[0] ? "ON" : "OFF") + "";
  	let t;

  	return {
  		c() {
  			span = element("span");
  			t = text(t_value);
  			attr(span, "slot", "label");
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);
  			append(span, t);
  		},
  		p(ctx, dirty) {
  			if (dirty & /*selected*/ 1 && t_value !== (t_value = (/*selected*/ ctx[0] ? "ON" : "OFF") + "")) set_data(t, t_value);
  		},
  		d(detaching) {
  			if (detaching) detach(span);
  		}
  	};
  }

  // (11:2) <FormField>
  function create_default_slot_1$1(ctx) {
  	let updating_checked;
  	let t;
  	let current;

  	function switch_1_checked_binding(value) {
  		/*switch_1_checked_binding*/ ctx[1].call(null, value);
  	}

  	let switch_1_props = {};

  	if (/*selected*/ ctx[0] !== void 0) {
  		switch_1_props.checked = /*selected*/ ctx[0];
  	}

  	const switch_1 = new Switch({ props: switch_1_props });
  	binding_callbacks.push(() => bind(switch_1, "checked", switch_1_checked_binding));

  	return {
  		c() {
  			create_component(switch_1.$$.fragment);
  			t = space();
  		},
  		m(target, anchor) {
  			mount_component(switch_1, target, anchor);
  			insert(target, t, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const switch_1_changes = {};

  			if (!updating_checked && dirty & /*selected*/ 1) {
  				updating_checked = true;
  				switch_1_changes.checked = /*selected*/ ctx[0];
  				add_flush_callback(() => updating_checked = false);
  			}

  			switch_1.$set(switch_1_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(switch_1.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(switch_1.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(switch_1, detaching);
  			if (detaching) detach(t);
  		}
  	};
  }

  // (10:4) <Card style="width: 360px;">
  function create_default_slot$2(ctx) {
  	let current;

  	const formfield = new FormField({
  			props: {
  				$$slots: {
  					default: [create_default_slot_1$1],
  					label: [create_label_slot]
  				},
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(formfield.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(formfield, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const formfield_changes = {};

  			if (dirty & /*$$scope, selected*/ 5) {
  				formfield_changes.$$scope = { dirty, ctx };
  			}

  			formfield.$set(formfield_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(formfield.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(formfield.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(formfield, detaching);
  		}
  	};
  }

  function create_fragment$9(ctx) {
  	let div;
  	let current;

  	const card = new Card({
  			props: {
  				style: "width: 360px;",
  				$$slots: { default: [create_default_slot$2] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			div = element("div");
  			create_component(card.$$.fragment);
  			attr(div, "class", "container");
  		},
  		m(target, anchor) {
  			insert(target, div, anchor);
  			mount_component(card, div, null);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const card_changes = {};

  			if (dirty & /*$$scope, selected*/ 5) {
  				card_changes.$$scope = { dirty, ctx };
  			}

  			card.$set(card_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(card.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(card.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div);
  			destroy_component(card);
  		}
  	};
  }

  function instance$9($$self, $$props, $$invalidate) {
  	let selected = false;

  	function switch_1_checked_binding(value) {
  		selected = value;
  		$$invalidate(0, selected);
  	}

  	return [selected, switch_1_checked_binding];
  }

  class Switcher extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$9, create_fragment$9, safe_not_equal, {});
  	}
  }

  /* NotFound.svelte generated by Svelte v3.18.1 */

  function create_default_slot$3(ctx) {
  	let span;

  	return {
  		c() {
  			span = element("span");
  			span.textContent = "Not Found";
  			set_style(span, "color", "red");
  			set_style(span, "font-weight", "bolder");
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(span);
  		}
  	};
  }

  function create_fragment$a(ctx) {
  	let div;
  	let current;

  	const card = new Card({
  			props: {
  				$$slots: { default: [create_default_slot$3] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			div = element("div");
  			create_component(card.$$.fragment);
  			attr(div, "class", "container");
  		},
  		m(target, anchor) {
  			insert(target, div, anchor);
  			mount_component(card, div, null);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const card_changes = {};

  			if (dirty & /*$$scope*/ 1) {
  				card_changes.$$scope = { dirty, ctx };
  			}

  			card.$set(card_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(card.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(card.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div);
  			destroy_component(card);
  		}
  	};
  }

  class NotFound extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, null, create_fragment$a, safe_not_equal, {});
  	}
  }

  const subscriber_queue = [];
  /**
   * Creates a `Readable` store that allows reading by subscription.
   * @param value initial value
   * @param {StartStopNotifier}start start and stop notifications for subscriptions
   */
  function readable(value, start) {
      return {
          subscribe: writable(value, start).subscribe,
      };
  }
  /**
   * Create a `Writable` store that allows both updating and reading by subscription.
   * @param {*=}value initial value
   * @param {StartStopNotifier=}start start and stop notifications for subscriptions
   */
  function writable(value, start = noop) {
      let stop;
      const subscribers = [];
      function set(new_value) {
          if (safe_not_equal(value, new_value)) {
              value = new_value;
              if (stop) { // store is ready
                  const run_queue = !subscriber_queue.length;
                  for (let i = 0; i < subscribers.length; i += 1) {
                      const s = subscribers[i];
                      s[1]();
                      subscriber_queue.push(s, value);
                  }
                  if (run_queue) {
                      for (let i = 0; i < subscriber_queue.length; i += 2) {
                          subscriber_queue[i][0](subscriber_queue[i + 1]);
                      }
                      subscriber_queue.length = 0;
                  }
              }
          }
      }
      function update(fn) {
          set(fn(value));
      }
      function subscribe(run, invalidate = noop) {
          const subscriber = [run, invalidate];
          subscribers.push(subscriber);
          if (subscribers.length === 1) {
              stop = start(set) || noop;
          }
          run(value);
          return () => {
              const index = subscribers.indexOf(subscriber);
              if (index !== -1) {
                  subscribers.splice(index, 1);
              }
              if (subscribers.length === 0) {
                  stop();
                  stop = null;
              }
          };
      }
      return { set, update, subscribe };
  }
  function derived(stores, fn, initial_value) {
      const single = !Array.isArray(stores);
      const stores_array = single
          ? [stores]
          : stores;
      const auto = fn.length < 2;
      return readable(initial_value, (set) => {
          let inited = false;
          const values = [];
          let pending = 0;
          let cleanup = noop;
          const sync = () => {
              if (pending) {
                  return;
              }
              cleanup();
              const result = fn(single ? values[0] : values, set);
              if (auto) {
                  set(result);
              }
              else {
                  cleanup = is_function(result) ? result : noop;
              }
          };
          const unsubscribers = stores_array.map((store, i) => subscribe(store, (value) => {
              values[i] = value;
              pending &= ~(1 << i);
              if (inited) {
                  sync();
              }
          }, () => {
              pending |= (1 << i);
          }));
          inited = true;
          sync();
          return function stop() {
              run_all(unsubscribers);
              cleanup();
          };
      });
  }

  function regexparam (str, loose) {
  	if (str instanceof RegExp) return { keys:false, pattern:str };
  	var c, o, tmp, ext, keys=[], pattern='', arr = str.split('/');
  	arr[0] || arr.shift();

  	while (tmp = arr.shift()) {
  		c = tmp[0];
  		if (c === '*') {
  			keys.push('wild');
  			pattern += '/(.*)';
  		} else if (c === ':') {
  			o = tmp.indexOf('?', 1);
  			ext = tmp.indexOf('.', 1);
  			keys.push( tmp.substring(1, !!~o ? o : !!~ext ? ext : tmp.length) );
  			pattern += !!~o && !~ext ? '(?:/([^/]+?))?' : '/([^/]+?)';
  			if (!!~ext) pattern += (!!~o ? '?' : '') + '\\' + tmp.substring(ext);
  		} else {
  			pattern += '/' + tmp;
  		}
  	}

  	return {
  		keys: keys,
  		pattern: new RegExp('^' + pattern + (loose ? '(?=$|\/)' : '\/?$'), 'i')
  	};
  }

  /* node_modules\svelte-spa-router\Router.svelte generated by Svelte v3.18.1 */

  function create_fragment$b(ctx) {
  	let switch_instance_anchor;
  	let current;
  	var switch_value = /*component*/ ctx[0];

  	function switch_props(ctx) {
  		return {
  			props: { params: /*componentParams*/ ctx[1] }
  		};
  	}

  	if (switch_value) {
  		var switch_instance = new switch_value(switch_props(ctx));
  	}

  	return {
  		c() {
  			if (switch_instance) create_component(switch_instance.$$.fragment);
  			switch_instance_anchor = empty();
  		},
  		m(target, anchor) {
  			if (switch_instance) {
  				mount_component(switch_instance, target, anchor);
  			}

  			insert(target, switch_instance_anchor, anchor);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const switch_instance_changes = {};
  			if (dirty & /*componentParams*/ 2) switch_instance_changes.params = /*componentParams*/ ctx[1];

  			if (switch_value !== (switch_value = /*component*/ ctx[0])) {
  				if (switch_instance) {
  					group_outros();
  					const old_component = switch_instance;

  					transition_out(old_component.$$.fragment, 1, 0, () => {
  						destroy_component(old_component, 1);
  					});

  					check_outros();
  				}

  				if (switch_value) {
  					switch_instance = new switch_value(switch_props(ctx));
  					create_component(switch_instance.$$.fragment);
  					transition_in(switch_instance.$$.fragment, 1);
  					mount_component(switch_instance, switch_instance_anchor.parentNode, switch_instance_anchor);
  				} else {
  					switch_instance = null;
  				}
  			} else if (switch_value) {
  				switch_instance.$set(switch_instance_changes);
  			}
  		},
  		i(local) {
  			if (current) return;
  			if (switch_instance) transition_in(switch_instance.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			if (switch_instance) transition_out(switch_instance.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(switch_instance_anchor);
  			if (switch_instance) destroy_component(switch_instance, detaching);
  		}
  	};
  }

  /**
   * @typedef {Object} Location
   * @property {string} location - Location (page/view), for example `/book`
   * @property {string} [querystring] - Querystring from the hash, as a string not parsed
   */
  /**
   * Returns the current location from the hash.
   *
   * @returns {Location} Location object
   * @private
   */
  function getLocation() {
  	const hashPosition = window.location.href.indexOf("#/");

  	let location = hashPosition > -1
  	? window.location.href.substr(hashPosition + 1)
  	: "/";

  	// Check if there's a querystring
  	const qsPosition = location.indexOf("?");

  	let querystring = "";

  	if (qsPosition > -1) {
  		querystring = location.substr(qsPosition + 1);
  		location = location.substr(0, qsPosition);
  	}

  	return { location, querystring };
  }

  const loc = readable(getLocation(), // eslint-disable-next-line prefer-arrow-callback
  function start(set) {
  	const update = () => {
  		set(getLocation());
  	};

  	window.addEventListener("hashchange", update, false);

  	return function stop() {
  		window.removeEventListener("hashchange", update, false);
  	};
  });

  const location = derived(loc, $loc => $loc.location);
  const querystring = derived(loc, $loc => $loc.querystring);

  function link(node) {
  	// Only apply to <a> tags
  	if (!node || !node.tagName || node.tagName.toLowerCase() != "a") {
  		throw Error("Action \"link\" can only be used with <a> tags");
  	}

  	// Destination must start with '/'
  	const href = node.getAttribute("href");

  	if (!href || href.length < 1 || href.charAt(0) != "/") {
  		throw Error("Invalid value for \"href\" attribute");
  	}

  	// Add # to every href attribute
  	node.setAttribute("href", "#" + href);
  }

  function instance$a($$self, $$props, $$invalidate) {
  	let $loc,
  		$$unsubscribe_loc = noop;

  	component_subscribe($$self, loc, $$value => $$invalidate(4, $loc = $$value));
  	$$self.$$.on_destroy.push(() => $$unsubscribe_loc());
  	let { routes = {} } = $$props;
  	let { prefix = "" } = $$props;

  	/**
   * Container for a route: path, component
   */
  	class RouteItem {
  		/**
   * Initializes the object and creates a regular expression from the path, using regexparam.
   *
   * @param {string} path - Path to the route (must start with '/' or '*')
   * @param {SvelteComponent} component - Svelte component for the route
   */
  		constructor(path, component) {
  			if (!component || typeof component != "function" && (typeof component != "object" || component._sveltesparouter !== true)) {
  				throw Error("Invalid component object");
  			}

  			// Path must be a regular or expression, or a string starting with '/' or '*'
  			if (!path || typeof path == "string" && (path.length < 1 || path.charAt(0) != "/" && path.charAt(0) != "*") || typeof path == "object" && !(path instanceof RegExp)) {
  				throw Error("Invalid value for \"path\" argument");
  			}

  			const { pattern, keys } = regexparam(path);
  			this.path = path;

  			// Check if the component is wrapped and we have conditions
  			if (typeof component == "object" && component._sveltesparouter === true) {
  				this.component = component.route;
  				this.conditions = component.conditions || [];
  				this.userData = component.userData;
  			} else {
  				this.component = component;
  				this.conditions = [];
  				this.userData = undefined;
  			}

  			this._pattern = pattern;
  			this._keys = keys;
  		}

  		/**
   * Checks if `path` matches the current route.
   * If there's a match, will return the list of parameters from the URL (if any).
   * In case of no match, the method will return `null`.
   *
   * @param {string} path - Path to test
   * @returns {null|Object.<string, string>} List of paramters from the URL if there's a match, or `null` otherwise.
   */
  		match(path) {
  			// If there's a prefix, remove it before we run the matching
  			if (prefix && path.startsWith(prefix)) {
  				path = path.substr(prefix.length) || "/";
  			}

  			// Check if the pattern matches
  			const matches = this._pattern.exec(path);

  			if (matches === null) {
  				return null;
  			}

  			// If the input was a regular expression, this._keys would be false, so return matches as is
  			if (this._keys === false) {
  				return matches;
  			}

  			const out = {};
  			let i = 0;

  			while (i < this._keys.length) {
  				out[this._keys[i]] = matches[++i] || null;
  			}

  			return out;
  		}

  		/**
   * Dictionary with route details passed to the pre-conditions functions, as well as the `routeLoaded` and `conditionsFailed` events
   * @typedef {Object} RouteDetail
   * @property {SvelteComponent} component - Svelte component
   * @property {string} name - Name of the Svelte component
   * @property {string} location - Location path
   * @property {string} querystring - Querystring from the hash
   * @property {Object} [userData] - Custom data passed by the user
   */
  		/**
   * Executes all conditions (if any) to control whether the route can be shown. Conditions are executed in the order they are defined, and if a condition fails, the following ones aren't executed.
   * 
   * @param {RouteDetail} detail - Route detail
   * @returns {bool} Returns true if all the conditions succeeded
   */
  		checkConditions(detail) {
  			for (let i = 0; i < this.conditions.length; i++) {
  				if (!this.conditions[i](detail)) {
  					return false;
  				}
  			}

  			return true;
  		}
  	}

  	// We need an iterable: if it's not a Map, use Object.entries
  	const routesIterable = routes instanceof Map ? routes : Object.entries(routes);

  	// Set up all routes
  	const routesList = [];

  	for (const [path, route] of routesIterable) {
  		routesList.push(new RouteItem(path, route));
  	}

  	// Props for the component to render
  	let component = null;

  	let componentParams = {};

  	// Event dispatcher from Svelte
  	const dispatch = createEventDispatcher();

  	// Just like dispatch, but executes on the next iteration of the event loop
  	const dispatchNextTick = (name, detail) => {
  		// Execute this code when the current call stack is complete
  		setTimeout(
  			() => {
  				dispatch(name, detail);
  			},
  			0
  		);
  	};

  	$$self.$set = $$props => {
  		if ("routes" in $$props) $$invalidate(2, routes = $$props.routes);
  		if ("prefix" in $$props) $$invalidate(3, prefix = $$props.prefix);
  	};

  	$$self.$$.update = () => {
  		if ($$self.$$.dirty & /*component, $loc*/ 17) {
  			// Handle hash change events
  			// Listen to changes in the $loc store and update the page
  			 {
  				// Find a route matching the location
  				$$invalidate(0, component = null);

  				let i = 0;

  				while (!component && i < routesList.length) {
  					const match = routesList[i].match($loc.location);

  					if (match) {
  						const detail = {
  							component: routesList[i].component,
  							name: routesList[i].component.name,
  							location: $loc.location,
  							querystring: $loc.querystring,
  							userData: routesList[i].userData
  						};

  						// Check if the route can be loaded - if all conditions succeed
  						if (!routesList[i].checkConditions(detail)) {
  							// Trigger an event to notify the user
  							dispatchNextTick("conditionsFailed", detail);

  							break;
  						}

  						$$invalidate(0, component = routesList[i].component);
  						$$invalidate(1, componentParams = match);
  						dispatchNextTick("routeLoaded", detail);
  					}

  					i++;
  				}
  			}
  		}
  	};

  	return [component, componentParams, routes, prefix];
  }

  class Router extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$a, create_fragment$b, safe_not_equal, { routes: 2, prefix: 3 });
  	}
  }

  /* App.svelte generated by Svelte v3.18.1 */

  function create_fragment$c(ctx) {
  	let a0;
  	let link_action;
  	let t1;
  	let a1;
  	let link_action_1;
  	let t3;
  	let a2;
  	let link_action_2;
  	let t5;
  	let current;
  	let dispose;
  	const router = new Router({ props: { routes: /*routes*/ ctx[0] } });

  	return {
  		c() {
  			a0 = element("a");
  			a0.textContent = "counter";
  			t1 = space();
  			a1 = element("a");
  			a1.textContent = "switch";
  			t3 = space();
  			a2 = element("a");
  			a2.textContent = "not found";
  			t5 = space();
  			create_component(router.$$.fragment);
  			attr(a0, "href", "/counter");
  			attr(a1, "href", "/switch");
  			attr(a2, "href", "/other");
  		},
  		m(target, anchor) {
  			insert(target, a0, anchor);
  			insert(target, t1, anchor);
  			insert(target, a1, anchor);
  			insert(target, t3, anchor);
  			insert(target, a2, anchor);
  			insert(target, t5, anchor);
  			mount_component(router, target, anchor);
  			current = true;

  			dispose = [
  				action_destroyer(link_action = link.call(null, a0)),
  				action_destroyer(link_action_1 = link.call(null, a1)),
  				action_destroyer(link_action_2 = link.call(null, a2))
  			];
  		},
  		p: noop,
  		i(local) {
  			if (current) return;
  			transition_in(router.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(router.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(a0);
  			if (detaching) detach(t1);
  			if (detaching) detach(a1);
  			if (detaching) detach(t3);
  			if (detaching) detach(a2);
  			if (detaching) detach(t5);
  			destroy_component(router, detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance$b($$self) {
  	const routes = {
  		// Exact path
  		// Using named parameters, with last being optional
  		"/counter": Counter,
  		// Wildcard parameter
  		"/switch": Switcher,
  		// Catch-all
  		// This is optional, but if present it must be the last
  		"*": NotFound
  	};

  	return [routes];
  }

  class App extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$b, create_fragment$c, safe_not_equal, {});
  	}
  }

  window.app = new App({
    target: document.getElementsByTagName('app')[0]
  });

}());
