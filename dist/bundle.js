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
  function set_input_value(input, value) {
      if (value != null || input.value) {
          input.value = value;
      }
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
  function afterUpdate(fn) {
      get_current_component().$$.after_update.push(fn);
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

  /* node_modules\@smui\common\ClassAdder.svelte generated by Svelte v3.18.1 */

  function create_default_slot(ctx) {
  	let current;
  	const default_slot_template = /*$$slots*/ ctx[8].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[9], null);

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
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 512) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[9], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[9], dirty, null));
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

  function create_fragment$1(ctx) {
  	let switch_instance_anchor;
  	let current;

  	const switch_instance_spread_levels = [
  		{
  			use: [/*forwardEvents*/ ctx[4], .../*use*/ ctx[0]]
  		},
  		{
  			class: "" + (/*smuiClass*/ ctx[3] + " " + /*className*/ ctx[1])
  		},
  		exclude(/*$$props*/ ctx[5], ["use", "class", "component", "forwardEvents"])
  	];

  	var switch_value = /*component*/ ctx[2];

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
  			const switch_instance_changes = (dirty & /*forwardEvents, use, smuiClass, className, exclude, $$props*/ 59)
  			? get_spread_update(switch_instance_spread_levels, [
  					dirty & /*forwardEvents, use*/ 17 && {
  						use: [/*forwardEvents*/ ctx[4], .../*use*/ ctx[0]]
  					},
  					dirty & /*smuiClass, className*/ 10 && {
  						class: "" + (/*smuiClass*/ ctx[3] + " " + /*className*/ ctx[1])
  					},
  					dirty & /*exclude, $$props*/ 32 && get_spread_object(exclude(/*$$props*/ ctx[5], ["use", "class", "component", "forwardEvents"]))
  				])
  			: {};

  			if (dirty & /*$$scope*/ 512) {
  				switch_instance_changes.$$scope = { dirty, ctx };
  			}

  			if (switch_value !== (switch_value = /*component*/ ctx[2])) {
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

  const internals = {
  	component: null,
  	smuiClass: null,
  	contexts: {}
  };

  function instance$1($$self, $$props, $$invalidate) {
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { component = internals.component } = $$props;
  	let { forwardEvents: smuiForwardEvents = [] } = $$props;
  	const smuiClass = internals.class;
  	const contexts = internals.contexts;
  	const forwardEvents = forwardEventsBuilder(current_component, smuiForwardEvents);

  	for (let context in contexts) {
  		if (contexts.hasOwnProperty(context)) {
  			setContext(context, contexts[context]);
  		}
  	}

  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(5, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("component" in $$new_props) $$invalidate(2, component = $$new_props.component);
  		if ("forwardEvents" in $$new_props) $$invalidate(6, smuiForwardEvents = $$new_props.forwardEvents);
  		if ("$$scope" in $$new_props) $$invalidate(9, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		component,
  		smuiClass,
  		forwardEvents,
  		$$props,
  		smuiForwardEvents,
  		contexts,
  		$$slots,
  		$$scope
  	];
  }

  class ClassAdder extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$1, create_fragment$1, safe_not_equal, {
  			use: 0,
  			class: 1,
  			component: 2,
  			forwardEvents: 6
  		});
  	}
  }

  function classAdderBuilder(props) {
    function Component(...args) {
      Object.assign(internals, props);
      return new ClassAdder(...args);
    }

    Component.prototype = ClassAdder;

    // SSR support
    if (ClassAdder.$$render) {
      Component.$$render = (...args) => Object.assign(internals, props) && ClassAdder.$$render(...args);
    }
    if (ClassAdder.render) {
      Component.render = (...args) => Object.assign(internals, props) && ClassAdder.render(...args);
    }

    return Component;
  }

  /* node_modules\@smui\common\Div.svelte generated by Svelte v3.18.1 */

  function create_fragment$2(ctx) {
  	let div;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[4].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[3], null);
  	let div_levels = [exclude(/*$$props*/ ctx[2], ["use"])];
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
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[1].call(null, div))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 8) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[3], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[3], dirty, null));
  			}

  			set_attributes(div, get_spread_update(div_levels, [dirty & /*exclude, $$props*/ 4 && exclude(/*$$props*/ ctx[2], ["use"])]));
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

  class Div extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$2, create_fragment$2, safe_not_equal, { use: 0 });
  	}
  }

  classAdderBuilder({
    class: 'smui-card__content',
    component: Div,
    contexts: {}
  });

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
  /**
   * @fileoverview A "ponyfill" is a polyfill that doesn't modify the global prototype chain.
   * This makes ponyfills safer than traditional polyfills, especially for libraries like MDC.
   */
  function closest(element, selector) {
      if (element.closest) {
          return element.closest(selector);
      }
      var el = element;
      while (el) {
          if (matches(el, selector)) {
              return el;
          }
          el = el.parentElement;
      }
      return null;
  }
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

  classAdderBuilder({
    class: 'mdc-card__media-content',
    component: Div,
    contexts: {}
  });

  classAdderBuilder({
    class: 'mdc-card__action-buttons',
    component: Div,
    contexts: {}
  });

  classAdderBuilder({
    class: 'mdc-card__action-icons',
    component: Div,
    contexts: {}
  });

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

  // export const count = writable(0);

  // export const switched = writable(true);


  const createWritableStore = (key, startValue) => {
      const { subscribe, set, update } = writable(startValue);
      
        return {
        subscribe,
        update,
        set,
        useLocalStorage: () => {
          const json = localStorage.getItem(key);
          if (json) {
            set(JSON.parse(json));
          }
          
          subscribe(current => {
            localStorage.setItem(key, JSON.stringify(current));
          });
        }
      };
    };
    
    const count = createWritableStore('count', 0);

    const switched = createWritableStore('switched',false);

  /* node_modules\@smui\fab\Fab.svelte generated by Svelte v3.18.1 */

  function create_fragment$3(ctx) {
  	let button;
  	let useActions_action;
  	let forwardEvents_action;
  	let Ripple_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[10].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[9], null);

  	let button_levels = [
  		{
  			class: "\n    mdc-fab\n    " + /*className*/ ctx[1] + "\n    " + (/*mini*/ ctx[4] ? "mdc-fab--mini" : "") + "\n    " + (/*exited*/ ctx[5] ? "mdc-fab--exited" : "") + "\n    " + (/*extended*/ ctx[6] ? "mdc-fab--extended" : "") + "\n    " + (/*color*/ ctx[3] === "primary"
  			? "smui-fab--color-primary"
  			: "") + "\n  "
  		},
  		exclude(/*$$props*/ ctx[8], ["use", "class", "ripple", "color", "mini", "exited", "extended"])
  	];

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
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[7].call(null, button)),
  				action_destroyer(Ripple_action = Ripple.call(null, button, {
  					ripple: /*ripple*/ ctx[2],
  					unbounded: false
  				}))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 512) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[9], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[9], dirty, null));
  			}

  			set_attributes(button, get_spread_update(button_levels, [
  				dirty & /*className, mini, exited, extended, color*/ 122 && {
  					class: "\n    mdc-fab\n    " + /*className*/ ctx[1] + "\n    " + (/*mini*/ ctx[4] ? "mdc-fab--mini" : "") + "\n    " + (/*exited*/ ctx[5] ? "mdc-fab--exited" : "") + "\n    " + (/*extended*/ ctx[6] ? "mdc-fab--extended" : "") + "\n    " + (/*color*/ ctx[3] === "primary"
  					? "smui-fab--color-primary"
  					: "") + "\n  "
  				},
  				dirty & /*exclude, $$props*/ 256 && exclude(/*$$props*/ ctx[8], ["use", "class", "ripple", "color", "mini", "exited", "extended"])
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);

  			if (Ripple_action && is_function(Ripple_action.update) && dirty & /*ripple*/ 4) Ripple_action.update.call(null, {
  				ripple: /*ripple*/ ctx[2],
  				unbounded: false
  			});
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

  function instance$3($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { ripple = true } = $$props;
  	let { color = "secondary" } = $$props;
  	let { mini = false } = $$props;
  	let { exited = false } = $$props;
  	let { extended = false } = $$props;
  	setContext("SMUI:label:context", "fab");
  	setContext("SMUI:icon:context", "fab");
  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(8, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("ripple" in $$new_props) $$invalidate(2, ripple = $$new_props.ripple);
  		if ("color" in $$new_props) $$invalidate(3, color = $$new_props.color);
  		if ("mini" in $$new_props) $$invalidate(4, mini = $$new_props.mini);
  		if ("exited" in $$new_props) $$invalidate(5, exited = $$new_props.exited);
  		if ("extended" in $$new_props) $$invalidate(6, extended = $$new_props.extended);
  		if ("$$scope" in $$new_props) $$invalidate(9, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		ripple,
  		color,
  		mini,
  		exited,
  		extended,
  		forwardEvents,
  		$$props,
  		$$scope,
  		$$slots
  	];
  }

  class Fab extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$3, create_fragment$3, safe_not_equal, {
  			use: 0,
  			class: 1,
  			ripple: 2,
  			color: 3,
  			mini: 4,
  			exited: 5,
  			extended: 6
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

  function create_default_slot_5(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("autorenew");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (42:6) <Fab on:click={reset} class="row">
  function create_default_slot_4(ctx) {
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_5] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(icon.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(icon, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const icon_changes = {};

  			if (dirty & /*$$scope*/ 32) {
  				icon_changes.$$scope = { dirty, ctx };
  			}

  			icon.$set(icon_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(icon.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(icon.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(icon, detaching);
  		}
  	};
  }

  // (50:8) <Icon class="material-icons">
  function create_default_slot_3(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("remove_circle");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (49:6) <Fab on:click={dec} class="row">
  function create_default_slot_2(ctx) {
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_3] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(icon.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(icon, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const icon_changes = {};

  			if (dirty & /*$$scope*/ 32) {
  				icon_changes.$$scope = { dirty, ctx };
  			}

  			icon.$set(icon_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(icon.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(icon.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(icon, detaching);
  		}
  	};
  }

  // (56:8) <Icon class="material-icons">
  function create_default_slot_1(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("add_circle");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (55:6) <Fab on:click={inc} class="row">
  function create_default_slot$1(ctx) {
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_1] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(icon.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(icon, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const icon_changes = {};

  			if (dirty & /*$$scope*/ 32) {
  				icon_changes.$$scope = { dirty, ctx };
  			}

  			icon.$set(icon_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(icon.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(icon.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(icon, detaching);
  		}
  	};
  }

  // (64:6) {:else}
  function create_else_block(ctx) {
  	let h1;

  	return {
  		c() {
  			h1 = element("h1");
  			h1.textContent = "0";
  			attr(h1, "class", "grayed");
  			set_style(h1, "text-align", "center");
  		},
  		m(target, anchor) {
  			insert(target, h1, anchor);
  		},
  		p: noop,
  		d(detaching) {
  			if (detaching) detach(h1);
  		}
  	};
  }

  // (62:8) {#if clicked}
  function create_if_block(ctx) {
  	let h1;
  	let t;

  	return {
  		c() {
  			h1 = element("h1");
  			t = text(/*clicked*/ ctx[0]);
  			set_style(h1, "text-align", "center");
  		},
  		m(target, anchor) {
  			insert(target, h1, anchor);
  			append(h1, t);
  		},
  		p(ctx, dirty) {
  			if (dirty & /*clicked*/ 1) set_data(t, /*clicked*/ ctx[0]);
  		},
  		d(detaching) {
  			if (detaching) detach(h1);
  		}
  	};
  }

  function create_fragment$6(ctx) {
  	let div1;
  	let div0;
  	let t0;
  	let t1;
  	let t2;
  	let p;
  	let current;

  	const fab0 = new Fab({
  			props: {
  				class: "row",
  				$$slots: { default: [create_default_slot_4] },
  				$$scope: { ctx }
  			}
  		});

  	fab0.$on("click", /*reset*/ ctx[3]);

  	const fab1 = new Fab({
  			props: {
  				class: "row",
  				$$slots: { default: [create_default_slot_2] },
  				$$scope: { ctx }
  			}
  		});

  	fab1.$on("click", /*dec*/ ctx[2]);

  	const fab2 = new Fab({
  			props: {
  				class: "row",
  				$$slots: { default: [create_default_slot$1] },
  				$$scope: { ctx }
  			}
  		});

  	fab2.$on("click", /*inc*/ ctx[1]);

  	function select_block_type(ctx, dirty) {
  		if (/*clicked*/ ctx[0]) return create_if_block;
  		return create_else_block;
  	}

  	let current_block_type = select_block_type(ctx);
  	let if_block = current_block_type(ctx);

  	return {
  		c() {
  			div1 = element("div");
  			div0 = element("div");
  			create_component(fab0.$$.fragment);
  			t0 = space();
  			create_component(fab1.$$.fragment);
  			t1 = space();
  			create_component(fab2.$$.fragment);
  			t2 = space();
  			p = element("p");
  			if_block.c();
  			attr(p, "class", "mdc-typography--body1");
  			set_style(p, "text-align", "center");
  			set_style(div0, "margin", "0 auto");
  			set_style(div0, "width", "50%");
  			set_style(div0, "flex-wrap", "wrap");
  			set_style(div0, "padding", "10px");
  			set_style(div0, "display", "flex");
  			set_style(div0, "flex-direction", "column");
  			attr(div1, "class", "container");
  		},
  		m(target, anchor) {
  			insert(target, div1, anchor);
  			append(div1, div0);
  			mount_component(fab0, div0, null);
  			append(div0, t0);
  			mount_component(fab1, div0, null);
  			append(div0, t1);
  			mount_component(fab2, div0, null);
  			append(div0, t2);
  			append(div0, p);
  			if_block.m(p, null);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const fab0_changes = {};

  			if (dirty & /*$$scope*/ 32) {
  				fab0_changes.$$scope = { dirty, ctx };
  			}

  			fab0.$set(fab0_changes);
  			const fab1_changes = {};

  			if (dirty & /*$$scope*/ 32) {
  				fab1_changes.$$scope = { dirty, ctx };
  			}

  			fab1.$set(fab1_changes);
  			const fab2_changes = {};

  			if (dirty & /*$$scope*/ 32) {
  				fab2_changes.$$scope = { dirty, ctx };
  			}

  			fab2.$set(fab2_changes);

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
  			transition_in(fab0.$$.fragment, local);
  			transition_in(fab1.$$.fragment, local);
  			transition_in(fab2.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(fab0.$$.fragment, local);
  			transition_out(fab1.$$.fragment, local);
  			transition_out(fab2.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div1);
  			destroy_component(fab0);
  			destroy_component(fab1);
  			destroy_component(fab2);
  			if_block.d();
  		}
  	};
  }

  function instance$6($$self, $$props, $$invalidate) {
  	count.useLocalStorage();
  	let clicked = 0;

  	let inc = function () {
  		count.update(n => n + 1);
  	};

  	let dec = function () {
  		if (clicked > 0) {
  			count.update(n => n - 1);
  		}
  	};

  	let reset = function () {
  		count.set(0);
  	};

  	const unsubscribe = count.subscribe(value => {
  		$$invalidate(0, clicked = value);
  	});

  	return [clicked, inc, dec, reset];
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

  // (22:2) <FormField>
  function create_default_slot_1$1(ctx) {
  	let t;
  	let current;
  	const switch_1 = new Switch({ props: { checked: /*selected*/ ctx[0] } });
  	switch_1.$on("click", /*toggle*/ ctx[1]);

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
  			if (dirty & /*selected*/ 1) switch_1_changes.checked = /*selected*/ ctx[0];
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

  // (21:4) <Card >
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

  			if (dirty & /*$$scope, selected*/ 9) {
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

  			if (dirty & /*$$scope, selected*/ 9) {
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
  	switched.useLocalStorage();
  	let selected = false;

  	const unsubscribe = switched.subscribe(value => {
  		$$invalidate(0, selected = value);
  	});

  	let toggle = function () {
  		switched.update(n => !n);
  	};

  	return [selected, toggle];
  }

  class Switcher extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$9, create_fragment$9, safe_not_equal, {});
  	}
  }

  /* node_modules\@smui\common\A.svelte generated by Svelte v3.18.1 */

  function create_fragment$a(ctx) {
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

  function instance$a($$self, $$props, $$invalidate) {
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
  		init(this, options, instance$a, create_fragment$a, safe_not_equal, { use: 0, href: 1 });
  	}
  }

  /* node_modules\@smui\common\Button.svelte generated by Svelte v3.18.1 */

  function create_fragment$b(ctx) {
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

  function instance$b($$self, $$props, $$invalidate) {
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
  		init(this, options, instance$b, create_fragment$b, safe_not_equal, { use: 0 });
  	}
  }

  /* node_modules\@smui\button\Button.svelte generated by Svelte v3.18.1 */

  function create_default_slot$3(ctx) {
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

  function create_fragment$c(ctx) {
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
  			$$slots: { default: [create_default_slot$3] },
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

  function instance$c($$self, $$props, $$invalidate) {
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

  		init(this, options, instance$c, create_fragment$c, safe_not_equal, {
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
  var cssClasses$3 = {
      LABEL_FLOAT_ABOVE: 'mdc-floating-label--float-above',
      LABEL_SHAKE: 'mdc-floating-label--shake',
      ROOT: 'mdc-floating-label',
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
  var MDCFloatingLabelFoundation = /** @class */ (function (_super) {
      __extends(MDCFloatingLabelFoundation, _super);
      function MDCFloatingLabelFoundation(adapter) {
          var _this = _super.call(this, __assign({}, MDCFloatingLabelFoundation.defaultAdapter, adapter)) || this;
          _this.shakeAnimationEndHandler_ = function () { return _this.handleShakeAnimationEnd_(); };
          return _this;
      }
      Object.defineProperty(MDCFloatingLabelFoundation, "cssClasses", {
          get: function () {
              return cssClasses$3;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCFloatingLabelFoundation, "defaultAdapter", {
          /**
           * See {@link MDCFloatingLabelAdapter} for typing information on parameters and return types.
           */
          get: function () {
              // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
              return {
                  addClass: function () { return undefined; },
                  removeClass: function () { return undefined; },
                  getWidth: function () { return 0; },
                  registerInteractionHandler: function () { return undefined; },
                  deregisterInteractionHandler: function () { return undefined; },
              };
              // tslint:enable:object-literal-sort-keys
          },
          enumerable: true,
          configurable: true
      });
      MDCFloatingLabelFoundation.prototype.init = function () {
          this.adapter_.registerInteractionHandler('animationend', this.shakeAnimationEndHandler_);
      };
      MDCFloatingLabelFoundation.prototype.destroy = function () {
          this.adapter_.deregisterInteractionHandler('animationend', this.shakeAnimationEndHandler_);
      };
      /**
       * Returns the width of the label element.
       */
      MDCFloatingLabelFoundation.prototype.getWidth = function () {
          return this.adapter_.getWidth();
      };
      /**
       * Styles the label to produce a shake animation to indicate an error.
       * @param shouldShake If true, adds the shake CSS class; otherwise, removes shake class.
       */
      MDCFloatingLabelFoundation.prototype.shake = function (shouldShake) {
          var LABEL_SHAKE = MDCFloatingLabelFoundation.cssClasses.LABEL_SHAKE;
          if (shouldShake) {
              this.adapter_.addClass(LABEL_SHAKE);
          }
          else {
              this.adapter_.removeClass(LABEL_SHAKE);
          }
      };
      /**
       * Styles the label to float or dock.
       * @param shouldFloat If true, adds the float CSS class; otherwise, removes float and shake classes to dock the label.
       */
      MDCFloatingLabelFoundation.prototype.float = function (shouldFloat) {
          var _a = MDCFloatingLabelFoundation.cssClasses, LABEL_FLOAT_ABOVE = _a.LABEL_FLOAT_ABOVE, LABEL_SHAKE = _a.LABEL_SHAKE;
          if (shouldFloat) {
              this.adapter_.addClass(LABEL_FLOAT_ABOVE);
          }
          else {
              this.adapter_.removeClass(LABEL_FLOAT_ABOVE);
              this.adapter_.removeClass(LABEL_SHAKE);
          }
      };
      MDCFloatingLabelFoundation.prototype.handleShakeAnimationEnd_ = function () {
          var LABEL_SHAKE = MDCFloatingLabelFoundation.cssClasses.LABEL_SHAKE;
          this.adapter_.removeClass(LABEL_SHAKE);
      };
      return MDCFloatingLabelFoundation;
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
  var MDCFloatingLabel = /** @class */ (function (_super) {
      __extends(MDCFloatingLabel, _super);
      function MDCFloatingLabel() {
          return _super !== null && _super.apply(this, arguments) || this;
      }
      MDCFloatingLabel.attachTo = function (root) {
          return new MDCFloatingLabel(root);
      };
      /**
       * Styles the label to produce the label shake for errors.
       * @param shouldShake If true, shakes the label by adding a CSS class; otherwise, stops shaking by removing the class.
       */
      MDCFloatingLabel.prototype.shake = function (shouldShake) {
          this.foundation_.shake(shouldShake);
      };
      /**
       * Styles the label to float/dock.
       * @param shouldFloat If true, floats the label by adding a CSS class; otherwise, docks it by removing the class.
       */
      MDCFloatingLabel.prototype.float = function (shouldFloat) {
          this.foundation_.float(shouldFloat);
      };
      MDCFloatingLabel.prototype.getWidth = function () {
          return this.foundation_.getWidth();
      };
      MDCFloatingLabel.prototype.getDefaultFoundation = function () {
          var _this = this;
          // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
          // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
          // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
          var adapter = {
              addClass: function (className) { return _this.root_.classList.add(className); },
              removeClass: function (className) { return _this.root_.classList.remove(className); },
              getWidth: function () { return _this.root_.scrollWidth; },
              registerInteractionHandler: function (evtType, handler) { return _this.listen(evtType, handler); },
              deregisterInteractionHandler: function (evtType, handler) { return _this.unlisten(evtType, handler); },
          };
          // tslint:enable:object-literal-sort-keys
          return new MDCFloatingLabelFoundation(adapter);
      };
      return MDCFloatingLabel;
  }(MDCComponent));

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
  var cssClasses$4 = {
      LINE_RIPPLE_ACTIVE: 'mdc-line-ripple--active',
      LINE_RIPPLE_DEACTIVATING: 'mdc-line-ripple--deactivating',
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
  var MDCLineRippleFoundation = /** @class */ (function (_super) {
      __extends(MDCLineRippleFoundation, _super);
      function MDCLineRippleFoundation(adapter) {
          var _this = _super.call(this, __assign({}, MDCLineRippleFoundation.defaultAdapter, adapter)) || this;
          _this.transitionEndHandler_ = function (evt) { return _this.handleTransitionEnd(evt); };
          return _this;
      }
      Object.defineProperty(MDCLineRippleFoundation, "cssClasses", {
          get: function () {
              return cssClasses$4;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCLineRippleFoundation, "defaultAdapter", {
          /**
           * See {@link MDCLineRippleAdapter} for typing information on parameters and return types.
           */
          get: function () {
              // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
              return {
                  addClass: function () { return undefined; },
                  removeClass: function () { return undefined; },
                  hasClass: function () { return false; },
                  setStyle: function () { return undefined; },
                  registerEventHandler: function () { return undefined; },
                  deregisterEventHandler: function () { return undefined; },
              };
              // tslint:enable:object-literal-sort-keys
          },
          enumerable: true,
          configurable: true
      });
      MDCLineRippleFoundation.prototype.init = function () {
          this.adapter_.registerEventHandler('transitionend', this.transitionEndHandler_);
      };
      MDCLineRippleFoundation.prototype.destroy = function () {
          this.adapter_.deregisterEventHandler('transitionend', this.transitionEndHandler_);
      };
      MDCLineRippleFoundation.prototype.activate = function () {
          this.adapter_.removeClass(cssClasses$4.LINE_RIPPLE_DEACTIVATING);
          this.adapter_.addClass(cssClasses$4.LINE_RIPPLE_ACTIVE);
      };
      MDCLineRippleFoundation.prototype.setRippleCenter = function (xCoordinate) {
          this.adapter_.setStyle('transform-origin', xCoordinate + "px center");
      };
      MDCLineRippleFoundation.prototype.deactivate = function () {
          this.adapter_.addClass(cssClasses$4.LINE_RIPPLE_DEACTIVATING);
      };
      MDCLineRippleFoundation.prototype.handleTransitionEnd = function (evt) {
          // Wait for the line ripple to be either transparent or opaque
          // before emitting the animation end event
          var isDeactivating = this.adapter_.hasClass(cssClasses$4.LINE_RIPPLE_DEACTIVATING);
          if (evt.propertyName === 'opacity') {
              if (isDeactivating) {
                  this.adapter_.removeClass(cssClasses$4.LINE_RIPPLE_ACTIVE);
                  this.adapter_.removeClass(cssClasses$4.LINE_RIPPLE_DEACTIVATING);
              }
          }
      };
      return MDCLineRippleFoundation;
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
  var MDCLineRipple = /** @class */ (function (_super) {
      __extends(MDCLineRipple, _super);
      function MDCLineRipple() {
          return _super !== null && _super.apply(this, arguments) || this;
      }
      MDCLineRipple.attachTo = function (root) {
          return new MDCLineRipple(root);
      };
      /**
       * Activates the line ripple
       */
      MDCLineRipple.prototype.activate = function () {
          this.foundation_.activate();
      };
      /**
       * Deactivates the line ripple
       */
      MDCLineRipple.prototype.deactivate = function () {
          this.foundation_.deactivate();
      };
      /**
       * Sets the transform origin given a user's click location.
       * The `rippleCenter` is the x-coordinate of the middle of the ripple.
       */
      MDCLineRipple.prototype.setRippleCenter = function (xCoordinate) {
          this.foundation_.setRippleCenter(xCoordinate);
      };
      MDCLineRipple.prototype.getDefaultFoundation = function () {
          var _this = this;
          // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
          // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
          // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
          var adapter = {
              addClass: function (className) { return _this.root_.classList.add(className); },
              removeClass: function (className) { return _this.root_.classList.remove(className); },
              hasClass: function (className) { return _this.root_.classList.contains(className); },
              setStyle: function (propertyName, value) { return _this.root_.style.setProperty(propertyName, value); },
              registerEventHandler: function (evtType, handler) { return _this.listen(evtType, handler); },
              deregisterEventHandler: function (evtType, handler) { return _this.unlisten(evtType, handler); },
          };
          // tslint:enable:object-literal-sort-keys
          return new MDCLineRippleFoundation(adapter);
      };
      return MDCLineRipple;
  }(MDCComponent));

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
  var strings$3 = {
      NOTCH_ELEMENT_SELECTOR: '.mdc-notched-outline__notch',
  };
  var numbers$1 = {
      // This should stay in sync with $mdc-notched-outline-padding * 2.
      NOTCH_ELEMENT_PADDING: 8,
  };
  var cssClasses$5 = {
      NO_LABEL: 'mdc-notched-outline--no-label',
      OUTLINE_NOTCHED: 'mdc-notched-outline--notched',
      OUTLINE_UPGRADED: 'mdc-notched-outline--upgraded',
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
  var MDCNotchedOutlineFoundation = /** @class */ (function (_super) {
      __extends(MDCNotchedOutlineFoundation, _super);
      function MDCNotchedOutlineFoundation(adapter) {
          return _super.call(this, __assign({}, MDCNotchedOutlineFoundation.defaultAdapter, adapter)) || this;
      }
      Object.defineProperty(MDCNotchedOutlineFoundation, "strings", {
          get: function () {
              return strings$3;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCNotchedOutlineFoundation, "cssClasses", {
          get: function () {
              return cssClasses$5;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCNotchedOutlineFoundation, "numbers", {
          get: function () {
              return numbers$1;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCNotchedOutlineFoundation, "defaultAdapter", {
          /**
           * See {@link MDCNotchedOutlineAdapter} for typing information on parameters and return types.
           */
          get: function () {
              // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
              return {
                  addClass: function () { return undefined; },
                  removeClass: function () { return undefined; },
                  setNotchWidthProperty: function () { return undefined; },
                  removeNotchWidthProperty: function () { return undefined; },
              };
              // tslint:enable:object-literal-sort-keys
          },
          enumerable: true,
          configurable: true
      });
      /**
       * Adds the outline notched selector and updates the notch width calculated based off of notchWidth.
       */
      MDCNotchedOutlineFoundation.prototype.notch = function (notchWidth) {
          var OUTLINE_NOTCHED = MDCNotchedOutlineFoundation.cssClasses.OUTLINE_NOTCHED;
          if (notchWidth > 0) {
              notchWidth += numbers$1.NOTCH_ELEMENT_PADDING; // Add padding from left/right.
          }
          this.adapter_.setNotchWidthProperty(notchWidth);
          this.adapter_.addClass(OUTLINE_NOTCHED);
      };
      /**
       * Removes notched outline selector to close the notch in the outline.
       */
      MDCNotchedOutlineFoundation.prototype.closeNotch = function () {
          var OUTLINE_NOTCHED = MDCNotchedOutlineFoundation.cssClasses.OUTLINE_NOTCHED;
          this.adapter_.removeClass(OUTLINE_NOTCHED);
          this.adapter_.removeNotchWidthProperty();
      };
      return MDCNotchedOutlineFoundation;
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
  var MDCNotchedOutline = /** @class */ (function (_super) {
      __extends(MDCNotchedOutline, _super);
      function MDCNotchedOutline() {
          return _super !== null && _super.apply(this, arguments) || this;
      }
      MDCNotchedOutline.attachTo = function (root) {
          return new MDCNotchedOutline(root);
      };
      MDCNotchedOutline.prototype.initialSyncWithDOM = function () {
          this.notchElement_ = this.root_.querySelector(strings$3.NOTCH_ELEMENT_SELECTOR);
          var label = this.root_.querySelector('.' + MDCFloatingLabelFoundation.cssClasses.ROOT);
          if (label) {
              label.style.transitionDuration = '0s';
              this.root_.classList.add(cssClasses$5.OUTLINE_UPGRADED);
              requestAnimationFrame(function () {
                  label.style.transitionDuration = '';
              });
          }
          else {
              this.root_.classList.add(cssClasses$5.NO_LABEL);
          }
      };
      /**
       * Updates classes and styles to open the notch to the specified width.
       * @param notchWidth The notch width in the outline.
       */
      MDCNotchedOutline.prototype.notch = function (notchWidth) {
          this.foundation_.notch(notchWidth);
      };
      /**
       * Updates classes and styles to close the notch.
       */
      MDCNotchedOutline.prototype.closeNotch = function () {
          this.foundation_.closeNotch();
      };
      MDCNotchedOutline.prototype.getDefaultFoundation = function () {
          var _this = this;
          // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
          // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
          // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
          var adapter = {
              addClass: function (className) { return _this.root_.classList.add(className); },
              removeClass: function (className) { return _this.root_.classList.remove(className); },
              setNotchWidthProperty: function (width) { return _this.notchElement_.style.setProperty('width', width + 'px'); },
              removeNotchWidthProperty: function () { return _this.notchElement_.style.removeProperty('width'); },
          };
          // tslint:enable:object-literal-sort-keys
          return new MDCNotchedOutlineFoundation(adapter);
      };
      return MDCNotchedOutline;
  }(MDCComponent));

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
  var cssClasses$6 = {
      ROOT: 'mdc-text-field-character-counter',
  };
  var strings$4 = {
      ROOT_SELECTOR: "." + cssClasses$6.ROOT,
  };

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
  var MDCTextFieldCharacterCounterFoundation = /** @class */ (function (_super) {
      __extends(MDCTextFieldCharacterCounterFoundation, _super);
      function MDCTextFieldCharacterCounterFoundation(adapter) {
          return _super.call(this, __assign({}, MDCTextFieldCharacterCounterFoundation.defaultAdapter, adapter)) || this;
      }
      Object.defineProperty(MDCTextFieldCharacterCounterFoundation, "cssClasses", {
          get: function () {
              return cssClasses$6;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextFieldCharacterCounterFoundation, "strings", {
          get: function () {
              return strings$4;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextFieldCharacterCounterFoundation, "defaultAdapter", {
          /**
           * See {@link MDCTextFieldCharacterCounterAdapter} for typing information on parameters and return types.
           */
          get: function () {
              return {
                  setContent: function () { return undefined; },
              };
          },
          enumerable: true,
          configurable: true
      });
      MDCTextFieldCharacterCounterFoundation.prototype.setCounterValue = function (currentLength, maxLength) {
          currentLength = Math.min(currentLength, maxLength);
          this.adapter_.setContent(currentLength + " / " + maxLength);
      };
      return MDCTextFieldCharacterCounterFoundation;
  }(MDCFoundation));

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
  var MDCTextFieldCharacterCounter = /** @class */ (function (_super) {
      __extends(MDCTextFieldCharacterCounter, _super);
      function MDCTextFieldCharacterCounter() {
          return _super !== null && _super.apply(this, arguments) || this;
      }
      MDCTextFieldCharacterCounter.attachTo = function (root) {
          return new MDCTextFieldCharacterCounter(root);
      };
      Object.defineProperty(MDCTextFieldCharacterCounter.prototype, "foundation", {
          get: function () {
              return this.foundation_;
          },
          enumerable: true,
          configurable: true
      });
      MDCTextFieldCharacterCounter.prototype.getDefaultFoundation = function () {
          var _this = this;
          // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
          // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
          var adapter = {
              setContent: function (content) {
                  _this.root_.textContent = content;
              },
          };
          return new MDCTextFieldCharacterCounterFoundation(adapter);
      };
      return MDCTextFieldCharacterCounter;
  }(MDCComponent));

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
  var strings$5 = {
      ARIA_CONTROLS: 'aria-controls',
      ICON_SELECTOR: '.mdc-text-field__icon',
      INPUT_SELECTOR: '.mdc-text-field__input',
      LABEL_SELECTOR: '.mdc-floating-label',
      LINE_RIPPLE_SELECTOR: '.mdc-line-ripple',
      OUTLINE_SELECTOR: '.mdc-notched-outline',
  };
  var cssClasses$7 = {
      DENSE: 'mdc-text-field--dense',
      DISABLED: 'mdc-text-field--disabled',
      FOCUSED: 'mdc-text-field--focused',
      FULLWIDTH: 'mdc-text-field--fullwidth',
      HELPER_LINE: 'mdc-text-field-helper-line',
      INVALID: 'mdc-text-field--invalid',
      NO_LABEL: 'mdc-text-field--no-label',
      OUTLINED: 'mdc-text-field--outlined',
      ROOT: 'mdc-text-field',
      TEXTAREA: 'mdc-text-field--textarea',
      WITH_LEADING_ICON: 'mdc-text-field--with-leading-icon',
      WITH_TRAILING_ICON: 'mdc-text-field--with-trailing-icon',
  };
  var numbers$2 = {
      DENSE_LABEL_SCALE: 0.923,
      LABEL_SCALE: 0.75,
  };
  /**
   * Whitelist based off of https://developer.mozilla.org/en-US/docs/Web/Guide/HTML/HTML5/Constraint_validation
   * under the "Validation-related attributes" section.
   */
  var VALIDATION_ATTR_WHITELIST = [
      'pattern', 'min', 'max', 'required', 'step', 'minlength', 'maxlength',
  ];
  /**
   * Label should always float for these types as they show some UI even if value is empty.
   */
  var ALWAYS_FLOAT_TYPES = [
      'color', 'date', 'datetime-local', 'month', 'range', 'time', 'week',
  ];

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
  var POINTERDOWN_EVENTS = ['mousedown', 'touchstart'];
  var INTERACTION_EVENTS = ['click', 'keydown'];
  var MDCTextFieldFoundation = /** @class */ (function (_super) {
      __extends(MDCTextFieldFoundation, _super);
      /**
       * @param adapter
       * @param foundationMap Map from subcomponent names to their subfoundations.
       */
      function MDCTextFieldFoundation(adapter, foundationMap) {
          if (foundationMap === void 0) { foundationMap = {}; }
          var _this = _super.call(this, __assign({}, MDCTextFieldFoundation.defaultAdapter, adapter)) || this;
          _this.isFocused_ = false;
          _this.receivedUserInput_ = false;
          _this.isValid_ = true;
          _this.useNativeValidation_ = true;
          _this.helperText_ = foundationMap.helperText;
          _this.characterCounter_ = foundationMap.characterCounter;
          _this.leadingIcon_ = foundationMap.leadingIcon;
          _this.trailingIcon_ = foundationMap.trailingIcon;
          _this.inputFocusHandler_ = function () { return _this.activateFocus(); };
          _this.inputBlurHandler_ = function () { return _this.deactivateFocus(); };
          _this.inputInputHandler_ = function () { return _this.handleInput(); };
          _this.setPointerXOffset_ = function (evt) { return _this.setTransformOrigin(evt); };
          _this.textFieldInteractionHandler_ = function () { return _this.handleTextFieldInteraction(); };
          _this.validationAttributeChangeHandler_ = function (attributesList) { return _this.handleValidationAttributeChange(attributesList); };
          return _this;
      }
      Object.defineProperty(MDCTextFieldFoundation, "cssClasses", {
          get: function () {
              return cssClasses$7;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextFieldFoundation, "strings", {
          get: function () {
              return strings$5;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextFieldFoundation, "numbers", {
          get: function () {
              return numbers$2;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextFieldFoundation.prototype, "shouldAlwaysFloat_", {
          get: function () {
              var type = this.getNativeInput_().type;
              return ALWAYS_FLOAT_TYPES.indexOf(type) >= 0;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextFieldFoundation.prototype, "shouldFloat", {
          get: function () {
              return this.shouldAlwaysFloat_ || this.isFocused_ || Boolean(this.getValue()) || this.isBadInput_();
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextFieldFoundation.prototype, "shouldShake", {
          get: function () {
              return !this.isFocused_ && !this.isValid() && Boolean(this.getValue());
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextFieldFoundation, "defaultAdapter", {
          /**
           * See {@link MDCTextFieldAdapter} for typing information on parameters and return types.
           */
          get: function () {
              // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
              return {
                  addClass: function () { return undefined; },
                  removeClass: function () { return undefined; },
                  hasClass: function () { return true; },
                  registerTextFieldInteractionHandler: function () { return undefined; },
                  deregisterTextFieldInteractionHandler: function () { return undefined; },
                  registerInputInteractionHandler: function () { return undefined; },
                  deregisterInputInteractionHandler: function () { return undefined; },
                  registerValidationAttributeChangeHandler: function () { return new MutationObserver(function () { return undefined; }); },
                  deregisterValidationAttributeChangeHandler: function () { return undefined; },
                  getNativeInput: function () { return null; },
                  isFocused: function () { return false; },
                  activateLineRipple: function () { return undefined; },
                  deactivateLineRipple: function () { return undefined; },
                  setLineRippleTransformOrigin: function () { return undefined; },
                  shakeLabel: function () { return undefined; },
                  floatLabel: function () { return undefined; },
                  hasLabel: function () { return false; },
                  getLabelWidth: function () { return 0; },
                  hasOutline: function () { return false; },
                  notchOutline: function () { return undefined; },
                  closeOutline: function () { return undefined; },
              };
              // tslint:enable:object-literal-sort-keys
          },
          enumerable: true,
          configurable: true
      });
      MDCTextFieldFoundation.prototype.init = function () {
          var _this = this;
          if (this.adapter_.isFocused()) {
              this.inputFocusHandler_();
          }
          else if (this.adapter_.hasLabel() && this.shouldFloat) {
              this.notchOutline(true);
              this.adapter_.floatLabel(true);
          }
          this.adapter_.registerInputInteractionHandler('focus', this.inputFocusHandler_);
          this.adapter_.registerInputInteractionHandler('blur', this.inputBlurHandler_);
          this.adapter_.registerInputInteractionHandler('input', this.inputInputHandler_);
          POINTERDOWN_EVENTS.forEach(function (evtType) {
              _this.adapter_.registerInputInteractionHandler(evtType, _this.setPointerXOffset_);
          });
          INTERACTION_EVENTS.forEach(function (evtType) {
              _this.adapter_.registerTextFieldInteractionHandler(evtType, _this.textFieldInteractionHandler_);
          });
          this.validationObserver_ =
              this.adapter_.registerValidationAttributeChangeHandler(this.validationAttributeChangeHandler_);
          this.setCharacterCounter_(this.getValue().length);
      };
      MDCTextFieldFoundation.prototype.destroy = function () {
          var _this = this;
          this.adapter_.deregisterInputInteractionHandler('focus', this.inputFocusHandler_);
          this.adapter_.deregisterInputInteractionHandler('blur', this.inputBlurHandler_);
          this.adapter_.deregisterInputInteractionHandler('input', this.inputInputHandler_);
          POINTERDOWN_EVENTS.forEach(function (evtType) {
              _this.adapter_.deregisterInputInteractionHandler(evtType, _this.setPointerXOffset_);
          });
          INTERACTION_EVENTS.forEach(function (evtType) {
              _this.adapter_.deregisterTextFieldInteractionHandler(evtType, _this.textFieldInteractionHandler_);
          });
          this.adapter_.deregisterValidationAttributeChangeHandler(this.validationObserver_);
      };
      /**
       * Handles user interactions with the Text Field.
       */
      MDCTextFieldFoundation.prototype.handleTextFieldInteraction = function () {
          var nativeInput = this.adapter_.getNativeInput();
          if (nativeInput && nativeInput.disabled) {
              return;
          }
          this.receivedUserInput_ = true;
      };
      /**
       * Handles validation attribute changes
       */
      MDCTextFieldFoundation.prototype.handleValidationAttributeChange = function (attributesList) {
          var _this = this;
          attributesList.some(function (attributeName) {
              if (VALIDATION_ATTR_WHITELIST.indexOf(attributeName) > -1) {
                  _this.styleValidity_(true);
                  return true;
              }
              return false;
          });
          if (attributesList.indexOf('maxlength') > -1) {
              this.setCharacterCounter_(this.getValue().length);
          }
      };
      /**
       * Opens/closes the notched outline.
       */
      MDCTextFieldFoundation.prototype.notchOutline = function (openNotch) {
          if (!this.adapter_.hasOutline()) {
              return;
          }
          if (openNotch) {
              var isDense = this.adapter_.hasClass(cssClasses$7.DENSE);
              var labelScale = isDense ? numbers$2.DENSE_LABEL_SCALE : numbers$2.LABEL_SCALE;
              var labelWidth = this.adapter_.getLabelWidth() * labelScale;
              this.adapter_.notchOutline(labelWidth);
          }
          else {
              this.adapter_.closeOutline();
          }
      };
      /**
       * Activates the text field focus state.
       */
      MDCTextFieldFoundation.prototype.activateFocus = function () {
          this.isFocused_ = true;
          this.styleFocused_(this.isFocused_);
          this.adapter_.activateLineRipple();
          if (this.adapter_.hasLabel()) {
              this.notchOutline(this.shouldFloat);
              this.adapter_.floatLabel(this.shouldFloat);
              this.adapter_.shakeLabel(this.shouldShake);
          }
          if (this.helperText_) {
              this.helperText_.showToScreenReader();
          }
      };
      /**
       * Sets the line ripple's transform origin, so that the line ripple activate
       * animation will animate out from the user's click location.
       */
      MDCTextFieldFoundation.prototype.setTransformOrigin = function (evt) {
          var touches = evt.touches;
          var targetEvent = touches ? touches[0] : evt;
          var targetClientRect = targetEvent.target.getBoundingClientRect();
          var normalizedX = targetEvent.clientX - targetClientRect.left;
          this.adapter_.setLineRippleTransformOrigin(normalizedX);
      };
      /**
       * Handles input change of text input and text area.
       */
      MDCTextFieldFoundation.prototype.handleInput = function () {
          this.autoCompleteFocus();
          this.setCharacterCounter_(this.getValue().length);
      };
      /**
       * Activates the Text Field's focus state in cases when the input value
       * changes without user input (e.g. programmatically).
       */
      MDCTextFieldFoundation.prototype.autoCompleteFocus = function () {
          if (!this.receivedUserInput_) {
              this.activateFocus();
          }
      };
      /**
       * Deactivates the Text Field's focus state.
       */
      MDCTextFieldFoundation.prototype.deactivateFocus = function () {
          this.isFocused_ = false;
          this.adapter_.deactivateLineRipple();
          var isValid = this.isValid();
          this.styleValidity_(isValid);
          this.styleFocused_(this.isFocused_);
          if (this.adapter_.hasLabel()) {
              this.notchOutline(this.shouldFloat);
              this.adapter_.floatLabel(this.shouldFloat);
              this.adapter_.shakeLabel(this.shouldShake);
          }
          if (!this.shouldFloat) {
              this.receivedUserInput_ = false;
          }
      };
      MDCTextFieldFoundation.prototype.getValue = function () {
          return this.getNativeInput_().value;
      };
      /**
       * @param value The value to set on the input Element.
       */
      MDCTextFieldFoundation.prototype.setValue = function (value) {
          // Prevent Safari from moving the caret to the end of the input when the value has not changed.
          if (this.getValue() !== value) {
              this.getNativeInput_().value = value;
          }
          this.setCharacterCounter_(value.length);
          var isValid = this.isValid();
          this.styleValidity_(isValid);
          if (this.adapter_.hasLabel()) {
              this.notchOutline(this.shouldFloat);
              this.adapter_.floatLabel(this.shouldFloat);
              this.adapter_.shakeLabel(this.shouldShake);
          }
      };
      /**
       * @return The custom validity state, if set; otherwise, the result of a native validity check.
       */
      MDCTextFieldFoundation.prototype.isValid = function () {
          return this.useNativeValidation_
              ? this.isNativeInputValid_() : this.isValid_;
      };
      /**
       * @param isValid Sets the custom validity state of the Text Field.
       */
      MDCTextFieldFoundation.prototype.setValid = function (isValid) {
          this.isValid_ = isValid;
          this.styleValidity_(isValid);
          var shouldShake = !isValid && !this.isFocused_;
          if (this.adapter_.hasLabel()) {
              this.adapter_.shakeLabel(shouldShake);
          }
      };
      /**
       * Enables or disables the use of native validation. Use this for custom validation.
       * @param useNativeValidation Set this to false to ignore native input validation.
       */
      MDCTextFieldFoundation.prototype.setUseNativeValidation = function (useNativeValidation) {
          this.useNativeValidation_ = useNativeValidation;
      };
      MDCTextFieldFoundation.prototype.isDisabled = function () {
          return this.getNativeInput_().disabled;
      };
      /**
       * @param disabled Sets the text-field disabled or enabled.
       */
      MDCTextFieldFoundation.prototype.setDisabled = function (disabled) {
          this.getNativeInput_().disabled = disabled;
          this.styleDisabled_(disabled);
      };
      /**
       * @param content Sets the content of the helper text.
       */
      MDCTextFieldFoundation.prototype.setHelperTextContent = function (content) {
          if (this.helperText_) {
              this.helperText_.setContent(content);
          }
      };
      /**
       * Sets the aria label of the leading icon.
       */
      MDCTextFieldFoundation.prototype.setLeadingIconAriaLabel = function (label) {
          if (this.leadingIcon_) {
              this.leadingIcon_.setAriaLabel(label);
          }
      };
      /**
       * Sets the text content of the leading icon.
       */
      MDCTextFieldFoundation.prototype.setLeadingIconContent = function (content) {
          if (this.leadingIcon_) {
              this.leadingIcon_.setContent(content);
          }
      };
      /**
       * Sets the aria label of the trailing icon.
       */
      MDCTextFieldFoundation.prototype.setTrailingIconAriaLabel = function (label) {
          if (this.trailingIcon_) {
              this.trailingIcon_.setAriaLabel(label);
          }
      };
      /**
       * Sets the text content of the trailing icon.
       */
      MDCTextFieldFoundation.prototype.setTrailingIconContent = function (content) {
          if (this.trailingIcon_) {
              this.trailingIcon_.setContent(content);
          }
      };
      /**
       * Sets character counter values that shows characters used and the total character limit.
       */
      MDCTextFieldFoundation.prototype.setCharacterCounter_ = function (currentLength) {
          if (!this.characterCounter_) {
              return;
          }
          var maxLength = this.getNativeInput_().maxLength;
          if (maxLength === -1) {
              throw new Error('MDCTextFieldFoundation: Expected maxlength html property on text input or textarea.');
          }
          this.characterCounter_.setCounterValue(currentLength, maxLength);
      };
      /**
       * @return True if the Text Field input fails in converting the user-supplied value.
       */
      MDCTextFieldFoundation.prototype.isBadInput_ = function () {
          // The badInput property is not supported in IE 11 💩.
          return this.getNativeInput_().validity.badInput || false;
      };
      /**
       * @return The result of native validity checking (ValidityState.valid).
       */
      MDCTextFieldFoundation.prototype.isNativeInputValid_ = function () {
          return this.getNativeInput_().validity.valid;
      };
      /**
       * Styles the component based on the validity state.
       */
      MDCTextFieldFoundation.prototype.styleValidity_ = function (isValid) {
          var INVALID = MDCTextFieldFoundation.cssClasses.INVALID;
          if (isValid) {
              this.adapter_.removeClass(INVALID);
          }
          else {
              this.adapter_.addClass(INVALID);
          }
          if (this.helperText_) {
              this.helperText_.setValidity(isValid);
          }
      };
      /**
       * Styles the component based on the focused state.
       */
      MDCTextFieldFoundation.prototype.styleFocused_ = function (isFocused) {
          var FOCUSED = MDCTextFieldFoundation.cssClasses.FOCUSED;
          if (isFocused) {
              this.adapter_.addClass(FOCUSED);
          }
          else {
              this.adapter_.removeClass(FOCUSED);
          }
      };
      /**
       * Styles the component based on the disabled state.
       */
      MDCTextFieldFoundation.prototype.styleDisabled_ = function (isDisabled) {
          var _a = MDCTextFieldFoundation.cssClasses, DISABLED = _a.DISABLED, INVALID = _a.INVALID;
          if (isDisabled) {
              this.adapter_.addClass(DISABLED);
              this.adapter_.removeClass(INVALID);
          }
          else {
              this.adapter_.removeClass(DISABLED);
          }
          if (this.leadingIcon_) {
              this.leadingIcon_.setDisabled(isDisabled);
          }
          if (this.trailingIcon_) {
              this.trailingIcon_.setDisabled(isDisabled);
          }
      };
      /**
       * @return The native text input element from the host environment, or an object with the same shape for unit tests.
       */
      MDCTextFieldFoundation.prototype.getNativeInput_ = function () {
          // this.adapter_ may be undefined in foundation unit tests. This happens when testdouble is creating a mock object
          // and invokes the shouldShake/shouldFloat getters (which in turn call getValue(), which calls this method) before
          // init() has been called from the MDCTextField constructor. To work around that issue, we return a dummy object.
          var nativeInput = this.adapter_ ? this.adapter_.getNativeInput() : null;
          return nativeInput || {
              disabled: false,
              maxLength: -1,
              type: 'input',
              validity: {
                  badInput: false,
                  valid: true,
              },
              value: '',
          };
      };
      return MDCTextFieldFoundation;
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
  var cssClasses$8 = {
      HELPER_TEXT_PERSISTENT: 'mdc-text-field-helper-text--persistent',
      HELPER_TEXT_VALIDATION_MSG: 'mdc-text-field-helper-text--validation-msg',
      ROOT: 'mdc-text-field-helper-text',
  };
  var strings$6 = {
      ARIA_HIDDEN: 'aria-hidden',
      ROLE: 'role',
      ROOT_SELECTOR: "." + cssClasses$8.ROOT,
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
  var MDCTextFieldHelperTextFoundation = /** @class */ (function (_super) {
      __extends(MDCTextFieldHelperTextFoundation, _super);
      function MDCTextFieldHelperTextFoundation(adapter) {
          return _super.call(this, __assign({}, MDCTextFieldHelperTextFoundation.defaultAdapter, adapter)) || this;
      }
      Object.defineProperty(MDCTextFieldHelperTextFoundation, "cssClasses", {
          get: function () {
              return cssClasses$8;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextFieldHelperTextFoundation, "strings", {
          get: function () {
              return strings$6;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextFieldHelperTextFoundation, "defaultAdapter", {
          /**
           * See {@link MDCTextFieldHelperTextAdapter} for typing information on parameters and return types.
           */
          get: function () {
              // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
              return {
                  addClass: function () { return undefined; },
                  removeClass: function () { return undefined; },
                  hasClass: function () { return false; },
                  setAttr: function () { return undefined; },
                  removeAttr: function () { return undefined; },
                  setContent: function () { return undefined; },
              };
              // tslint:enable:object-literal-sort-keys
          },
          enumerable: true,
          configurable: true
      });
      /**
       * Sets the content of the helper text field.
       */
      MDCTextFieldHelperTextFoundation.prototype.setContent = function (content) {
          this.adapter_.setContent(content);
      };
      /**
       * @param isPersistent Sets the persistency of the helper text.
       */
      MDCTextFieldHelperTextFoundation.prototype.setPersistent = function (isPersistent) {
          if (isPersistent) {
              this.adapter_.addClass(cssClasses$8.HELPER_TEXT_PERSISTENT);
          }
          else {
              this.adapter_.removeClass(cssClasses$8.HELPER_TEXT_PERSISTENT);
          }
      };
      /**
       * @param isValidation True to make the helper text act as an error validation message.
       */
      MDCTextFieldHelperTextFoundation.prototype.setValidation = function (isValidation) {
          if (isValidation) {
              this.adapter_.addClass(cssClasses$8.HELPER_TEXT_VALIDATION_MSG);
          }
          else {
              this.adapter_.removeClass(cssClasses$8.HELPER_TEXT_VALIDATION_MSG);
          }
      };
      /**
       * Makes the helper text visible to the screen reader.
       */
      MDCTextFieldHelperTextFoundation.prototype.showToScreenReader = function () {
          this.adapter_.removeAttr(strings$6.ARIA_HIDDEN);
      };
      /**
       * Sets the validity of the helper text based on the input validity.
       */
      MDCTextFieldHelperTextFoundation.prototype.setValidity = function (inputIsValid) {
          var helperTextIsPersistent = this.adapter_.hasClass(cssClasses$8.HELPER_TEXT_PERSISTENT);
          var helperTextIsValidationMsg = this.adapter_.hasClass(cssClasses$8.HELPER_TEXT_VALIDATION_MSG);
          var validationMsgNeedsDisplay = helperTextIsValidationMsg && !inputIsValid;
          if (validationMsgNeedsDisplay) {
              this.adapter_.setAttr(strings$6.ROLE, 'alert');
          }
          else {
              this.adapter_.removeAttr(strings$6.ROLE);
          }
          if (!helperTextIsPersistent && !validationMsgNeedsDisplay) {
              this.hide_();
          }
      };
      /**
       * Hides the help text from screen readers.
       */
      MDCTextFieldHelperTextFoundation.prototype.hide_ = function () {
          this.adapter_.setAttr(strings$6.ARIA_HIDDEN, 'true');
      };
      return MDCTextFieldHelperTextFoundation;
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
  var MDCTextFieldHelperText = /** @class */ (function (_super) {
      __extends(MDCTextFieldHelperText, _super);
      function MDCTextFieldHelperText() {
          return _super !== null && _super.apply(this, arguments) || this;
      }
      MDCTextFieldHelperText.attachTo = function (root) {
          return new MDCTextFieldHelperText(root);
      };
      Object.defineProperty(MDCTextFieldHelperText.prototype, "foundation", {
          get: function () {
              return this.foundation_;
          },
          enumerable: true,
          configurable: true
      });
      MDCTextFieldHelperText.prototype.getDefaultFoundation = function () {
          var _this = this;
          // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
          // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
          // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
          var adapter = {
              addClass: function (className) { return _this.root_.classList.add(className); },
              removeClass: function (className) { return _this.root_.classList.remove(className); },
              hasClass: function (className) { return _this.root_.classList.contains(className); },
              setAttr: function (attr, value) { return _this.root_.setAttribute(attr, value); },
              removeAttr: function (attr) { return _this.root_.removeAttribute(attr); },
              setContent: function (content) {
                  _this.root_.textContent = content;
              },
          };
          // tslint:enable:object-literal-sort-keys
          return new MDCTextFieldHelperTextFoundation(adapter);
      };
      return MDCTextFieldHelperText;
  }(MDCComponent));

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
  var strings$7 = {
      ICON_EVENT: 'MDCTextField:icon',
      ICON_ROLE: 'button',
  };
  var cssClasses$9 = {
      ROOT: 'mdc-text-field__icon',
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
  var INTERACTION_EVENTS$1 = ['click', 'keydown'];
  var MDCTextFieldIconFoundation = /** @class */ (function (_super) {
      __extends(MDCTextFieldIconFoundation, _super);
      function MDCTextFieldIconFoundation(adapter) {
          var _this = _super.call(this, __assign({}, MDCTextFieldIconFoundation.defaultAdapter, adapter)) || this;
          _this.savedTabIndex_ = null;
          _this.interactionHandler_ = function (evt) { return _this.handleInteraction(evt); };
          return _this;
      }
      Object.defineProperty(MDCTextFieldIconFoundation, "strings", {
          get: function () {
              return strings$7;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextFieldIconFoundation, "cssClasses", {
          get: function () {
              return cssClasses$9;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextFieldIconFoundation, "defaultAdapter", {
          /**
           * See {@link MDCTextFieldIconAdapter} for typing information on parameters and return types.
           */
          get: function () {
              // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
              return {
                  getAttr: function () { return null; },
                  setAttr: function () { return undefined; },
                  removeAttr: function () { return undefined; },
                  setContent: function () { return undefined; },
                  registerInteractionHandler: function () { return undefined; },
                  deregisterInteractionHandler: function () { return undefined; },
                  notifyIconAction: function () { return undefined; },
              };
              // tslint:enable:object-literal-sort-keys
          },
          enumerable: true,
          configurable: true
      });
      MDCTextFieldIconFoundation.prototype.init = function () {
          var _this = this;
          this.savedTabIndex_ = this.adapter_.getAttr('tabindex');
          INTERACTION_EVENTS$1.forEach(function (evtType) {
              _this.adapter_.registerInteractionHandler(evtType, _this.interactionHandler_);
          });
      };
      MDCTextFieldIconFoundation.prototype.destroy = function () {
          var _this = this;
          INTERACTION_EVENTS$1.forEach(function (evtType) {
              _this.adapter_.deregisterInteractionHandler(evtType, _this.interactionHandler_);
          });
      };
      MDCTextFieldIconFoundation.prototype.setDisabled = function (disabled) {
          if (!this.savedTabIndex_) {
              return;
          }
          if (disabled) {
              this.adapter_.setAttr('tabindex', '-1');
              this.adapter_.removeAttr('role');
          }
          else {
              this.adapter_.setAttr('tabindex', this.savedTabIndex_);
              this.adapter_.setAttr('role', strings$7.ICON_ROLE);
          }
      };
      MDCTextFieldIconFoundation.prototype.setAriaLabel = function (label) {
          this.adapter_.setAttr('aria-label', label);
      };
      MDCTextFieldIconFoundation.prototype.setContent = function (content) {
          this.adapter_.setContent(content);
      };
      MDCTextFieldIconFoundation.prototype.handleInteraction = function (evt) {
          var isEnterKey = evt.key === 'Enter' || evt.keyCode === 13;
          if (evt.type === 'click' || isEnterKey) {
              this.adapter_.notifyIconAction();
          }
      };
      return MDCTextFieldIconFoundation;
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
  var MDCTextFieldIcon = /** @class */ (function (_super) {
      __extends(MDCTextFieldIcon, _super);
      function MDCTextFieldIcon() {
          return _super !== null && _super.apply(this, arguments) || this;
      }
      MDCTextFieldIcon.attachTo = function (root) {
          return new MDCTextFieldIcon(root);
      };
      Object.defineProperty(MDCTextFieldIcon.prototype, "foundation", {
          get: function () {
              return this.foundation_;
          },
          enumerable: true,
          configurable: true
      });
      MDCTextFieldIcon.prototype.getDefaultFoundation = function () {
          var _this = this;
          // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
          // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
          // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
          var adapter = {
              getAttr: function (attr) { return _this.root_.getAttribute(attr); },
              setAttr: function (attr, value) { return _this.root_.setAttribute(attr, value); },
              removeAttr: function (attr) { return _this.root_.removeAttribute(attr); },
              setContent: function (content) {
                  _this.root_.textContent = content;
              },
              registerInteractionHandler: function (evtType, handler) { return _this.listen(evtType, handler); },
              deregisterInteractionHandler: function (evtType, handler) { return _this.unlisten(evtType, handler); },
              notifyIconAction: function () { return _this.emit(MDCTextFieldIconFoundation.strings.ICON_EVENT, {} /* evtData */, true /* shouldBubble */); },
          };
          // tslint:enable:object-literal-sort-keys
          return new MDCTextFieldIconFoundation(adapter);
      };
      return MDCTextFieldIcon;
  }(MDCComponent));

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
  var MDCTextField = /** @class */ (function (_super) {
      __extends(MDCTextField, _super);
      function MDCTextField() {
          return _super !== null && _super.apply(this, arguments) || this;
      }
      MDCTextField.attachTo = function (root) {
          return new MDCTextField(root);
      };
      MDCTextField.prototype.initialize = function (rippleFactory, lineRippleFactory, helperTextFactory, characterCounterFactory, iconFactory, labelFactory, outlineFactory) {
          if (rippleFactory === void 0) { rippleFactory = function (el, foundation) { return new MDCRipple(el, foundation); }; }
          if (lineRippleFactory === void 0) { lineRippleFactory = function (el) { return new MDCLineRipple(el); }; }
          if (helperTextFactory === void 0) { helperTextFactory = function (el) { return new MDCTextFieldHelperText(el); }; }
          if (characterCounterFactory === void 0) { characterCounterFactory = function (el) { return new MDCTextFieldCharacterCounter(el); }; }
          if (iconFactory === void 0) { iconFactory = function (el) { return new MDCTextFieldIcon(el); }; }
          if (labelFactory === void 0) { labelFactory = function (el) { return new MDCFloatingLabel(el); }; }
          if (outlineFactory === void 0) { outlineFactory = function (el) { return new MDCNotchedOutline(el); }; }
          this.input_ = this.root_.querySelector(strings$5.INPUT_SELECTOR);
          var labelElement = this.root_.querySelector(strings$5.LABEL_SELECTOR);
          this.label_ = labelElement ? labelFactory(labelElement) : null;
          var lineRippleElement = this.root_.querySelector(strings$5.LINE_RIPPLE_SELECTOR);
          this.lineRipple_ = lineRippleElement ? lineRippleFactory(lineRippleElement) : null;
          var outlineElement = this.root_.querySelector(strings$5.OUTLINE_SELECTOR);
          this.outline_ = outlineElement ? outlineFactory(outlineElement) : null;
          // Helper text
          var helperTextStrings = MDCTextFieldHelperTextFoundation.strings;
          var nextElementSibling = this.root_.nextElementSibling;
          var hasHelperLine = (nextElementSibling && nextElementSibling.classList.contains(cssClasses$7.HELPER_LINE));
          var helperTextEl = hasHelperLine && nextElementSibling && nextElementSibling.querySelector(helperTextStrings.ROOT_SELECTOR);
          this.helperText_ = helperTextEl ? helperTextFactory(helperTextEl) : null;
          // Character counter
          var characterCounterStrings = MDCTextFieldCharacterCounterFoundation.strings;
          var characterCounterEl = this.root_.querySelector(characterCounterStrings.ROOT_SELECTOR);
          // If character counter is not found in root element search in sibling element.
          if (!characterCounterEl && hasHelperLine && nextElementSibling) {
              characterCounterEl = nextElementSibling.querySelector(characterCounterStrings.ROOT_SELECTOR);
          }
          this.characterCounter_ = characterCounterEl ? characterCounterFactory(characterCounterEl) : null;
          this.leadingIcon_ = null;
          this.trailingIcon_ = null;
          var iconElements = this.root_.querySelectorAll(strings$5.ICON_SELECTOR);
          if (iconElements.length > 0) {
              if (iconElements.length > 1) { // Has both icons.
                  this.leadingIcon_ = iconFactory(iconElements[0]);
                  this.trailingIcon_ = iconFactory(iconElements[1]);
              }
              else {
                  if (this.root_.classList.contains(cssClasses$7.WITH_LEADING_ICON)) {
                      this.leadingIcon_ = iconFactory(iconElements[0]);
                  }
                  else {
                      this.trailingIcon_ = iconFactory(iconElements[0]);
                  }
              }
          }
          this.ripple = this.createRipple_(rippleFactory);
      };
      MDCTextField.prototype.destroy = function () {
          if (this.ripple) {
              this.ripple.destroy();
          }
          if (this.lineRipple_) {
              this.lineRipple_.destroy();
          }
          if (this.helperText_) {
              this.helperText_.destroy();
          }
          if (this.characterCounter_) {
              this.characterCounter_.destroy();
          }
          if (this.leadingIcon_) {
              this.leadingIcon_.destroy();
          }
          if (this.trailingIcon_) {
              this.trailingIcon_.destroy();
          }
          if (this.label_) {
              this.label_.destroy();
          }
          if (this.outline_) {
              this.outline_.destroy();
          }
          _super.prototype.destroy.call(this);
      };
      /**
       * Initializes the Text Field's internal state based on the environment's
       * state.
       */
      MDCTextField.prototype.initialSyncWithDOM = function () {
          this.disabled = this.input_.disabled;
      };
      Object.defineProperty(MDCTextField.prototype, "value", {
          get: function () {
              return this.foundation_.getValue();
          },
          /**
           * @param value The value to set on the input.
           */
          set: function (value) {
              this.foundation_.setValue(value);
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextField.prototype, "disabled", {
          get: function () {
              return this.foundation_.isDisabled();
          },
          /**
           * @param disabled Sets the Text Field disabled or enabled.
           */
          set: function (disabled) {
              this.foundation_.setDisabled(disabled);
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextField.prototype, "valid", {
          get: function () {
              return this.foundation_.isValid();
          },
          /**
           * @param valid Sets the Text Field valid or invalid.
           */
          set: function (valid) {
              this.foundation_.setValid(valid);
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextField.prototype, "required", {
          get: function () {
              return this.input_.required;
          },
          /**
           * @param required Sets the Text Field to required.
           */
          set: function (required) {
              this.input_.required = required;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextField.prototype, "pattern", {
          get: function () {
              return this.input_.pattern;
          },
          /**
           * @param pattern Sets the input element's validation pattern.
           */
          set: function (pattern) {
              this.input_.pattern = pattern;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextField.prototype, "minLength", {
          get: function () {
              return this.input_.minLength;
          },
          /**
           * @param minLength Sets the input element's minLength.
           */
          set: function (minLength) {
              this.input_.minLength = minLength;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextField.prototype, "maxLength", {
          get: function () {
              return this.input_.maxLength;
          },
          /**
           * @param maxLength Sets the input element's maxLength.
           */
          set: function (maxLength) {
              // Chrome throws exception if maxLength is set to a value less than zero
              if (maxLength < 0) {
                  this.input_.removeAttribute('maxLength');
              }
              else {
                  this.input_.maxLength = maxLength;
              }
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextField.prototype, "min", {
          get: function () {
              return this.input_.min;
          },
          /**
           * @param min Sets the input element's min.
           */
          set: function (min) {
              this.input_.min = min;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextField.prototype, "max", {
          get: function () {
              return this.input_.max;
          },
          /**
           * @param max Sets the input element's max.
           */
          set: function (max) {
              this.input_.max = max;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextField.prototype, "step", {
          get: function () {
              return this.input_.step;
          },
          /**
           * @param step Sets the input element's step.
           */
          set: function (step) {
              this.input_.step = step;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextField.prototype, "helperTextContent", {
          /**
           * Sets the helper text element content.
           */
          set: function (content) {
              this.foundation_.setHelperTextContent(content);
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextField.prototype, "leadingIconAriaLabel", {
          /**
           * Sets the aria label of the leading icon.
           */
          set: function (label) {
              this.foundation_.setLeadingIconAriaLabel(label);
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextField.prototype, "leadingIconContent", {
          /**
           * Sets the text content of the leading icon.
           */
          set: function (content) {
              this.foundation_.setLeadingIconContent(content);
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextField.prototype, "trailingIconAriaLabel", {
          /**
           * Sets the aria label of the trailing icon.
           */
          set: function (label) {
              this.foundation_.setTrailingIconAriaLabel(label);
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextField.prototype, "trailingIconContent", {
          /**
           * Sets the text content of the trailing icon.
           */
          set: function (content) {
              this.foundation_.setTrailingIconContent(content);
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTextField.prototype, "useNativeValidation", {
          /**
           * Enables or disables the use of native validation. Use this for custom validation.
           * @param useNativeValidation Set this to false to ignore native input validation.
           */
          set: function (useNativeValidation) {
              this.foundation_.setUseNativeValidation(useNativeValidation);
          },
          enumerable: true,
          configurable: true
      });
      /**
       * Focuses the input element.
       */
      MDCTextField.prototype.focus = function () {
          this.input_.focus();
      };
      /**
       * Recomputes the outline SVG path for the outline element.
       */
      MDCTextField.prototype.layout = function () {
          var openNotch = this.foundation_.shouldFloat;
          this.foundation_.notchOutline(openNotch);
      };
      MDCTextField.prototype.getDefaultFoundation = function () {
          // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
          // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
          // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
          var adapter = __assign({}, this.getRootAdapterMethods_(), this.getInputAdapterMethods_(), this.getLabelAdapterMethods_(), this.getLineRippleAdapterMethods_(), this.getOutlineAdapterMethods_());
          // tslint:enable:object-literal-sort-keys
          return new MDCTextFieldFoundation(adapter, this.getFoundationMap_());
      };
      MDCTextField.prototype.getRootAdapterMethods_ = function () {
          var _this = this;
          // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
          return {
              addClass: function (className) { return _this.root_.classList.add(className); },
              removeClass: function (className) { return _this.root_.classList.remove(className); },
              hasClass: function (className) { return _this.root_.classList.contains(className); },
              registerTextFieldInteractionHandler: function (evtType, handler) { return _this.listen(evtType, handler); },
              deregisterTextFieldInteractionHandler: function (evtType, handler) { return _this.unlisten(evtType, handler); },
              registerValidationAttributeChangeHandler: function (handler) {
                  var getAttributesList = function (mutationsList) {
                      return mutationsList
                          .map(function (mutation) { return mutation.attributeName; })
                          .filter(function (attributeName) { return attributeName; });
                  };
                  var observer = new MutationObserver(function (mutationsList) { return handler(getAttributesList(mutationsList)); });
                  var config = { attributes: true };
                  observer.observe(_this.input_, config);
                  return observer;
              },
              deregisterValidationAttributeChangeHandler: function (observer) { return observer.disconnect(); },
          };
          // tslint:enable:object-literal-sort-keys
      };
      MDCTextField.prototype.getInputAdapterMethods_ = function () {
          var _this = this;
          // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
          return {
              getNativeInput: function () { return _this.input_; },
              isFocused: function () { return document.activeElement === _this.input_; },
              registerInputInteractionHandler: function (evtType, handler) {
                  return _this.input_.addEventListener(evtType, handler, applyPassive());
              },
              deregisterInputInteractionHandler: function (evtType, handler) {
                  return _this.input_.removeEventListener(evtType, handler, applyPassive());
              },
          };
          // tslint:enable:object-literal-sort-keys
      };
      MDCTextField.prototype.getLabelAdapterMethods_ = function () {
          var _this = this;
          return {
              floatLabel: function (shouldFloat) { return _this.label_ && _this.label_.float(shouldFloat); },
              getLabelWidth: function () { return _this.label_ ? _this.label_.getWidth() : 0; },
              hasLabel: function () { return Boolean(_this.label_); },
              shakeLabel: function (shouldShake) { return _this.label_ && _this.label_.shake(shouldShake); },
          };
      };
      MDCTextField.prototype.getLineRippleAdapterMethods_ = function () {
          var _this = this;
          return {
              activateLineRipple: function () {
                  if (_this.lineRipple_) {
                      _this.lineRipple_.activate();
                  }
              },
              deactivateLineRipple: function () {
                  if (_this.lineRipple_) {
                      _this.lineRipple_.deactivate();
                  }
              },
              setLineRippleTransformOrigin: function (normalizedX) {
                  if (_this.lineRipple_) {
                      _this.lineRipple_.setRippleCenter(normalizedX);
                  }
              },
          };
      };
      MDCTextField.prototype.getOutlineAdapterMethods_ = function () {
          var _this = this;
          return {
              closeOutline: function () { return _this.outline_ && _this.outline_.closeNotch(); },
              hasOutline: function () { return Boolean(_this.outline_); },
              notchOutline: function (labelWidth) { return _this.outline_ && _this.outline_.notch(labelWidth); },
          };
      };
      /**
       * @return A map of all subcomponents to subfoundations.
       */
      MDCTextField.prototype.getFoundationMap_ = function () {
          return {
              characterCounter: this.characterCounter_ ? this.characterCounter_.foundation : undefined,
              helperText: this.helperText_ ? this.helperText_.foundation : undefined,
              leadingIcon: this.leadingIcon_ ? this.leadingIcon_.foundation : undefined,
              trailingIcon: this.trailingIcon_ ? this.trailingIcon_.foundation : undefined,
          };
      };
      MDCTextField.prototype.createRipple_ = function (rippleFactory) {
          var _this = this;
          var isTextArea = this.root_.classList.contains(cssClasses$7.TEXTAREA);
          var isOutlined = this.root_.classList.contains(cssClasses$7.OUTLINED);
          if (isTextArea || isOutlined) {
              return null;
          }
          // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
          // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
          // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
          var adapter = __assign({}, MDCRipple.createAdapter(this), { isSurfaceActive: function () { return matches(_this.input_, ':active'); }, registerInteractionHandler: function (evtType, handler) { return _this.input_.addEventListener(evtType, handler, applyPassive()); }, deregisterInteractionHandler: function (evtType, handler) {
                  return _this.input_.removeEventListener(evtType, handler, applyPassive());
              } });
          // tslint:enable:object-literal-sort-keys
          return rippleFactory(this.root_, new MDCRippleFoundation(adapter));
      };
      return MDCTextField;
  }(MDCComponent));

  /* node_modules\@smui\floating-label\FloatingLabel.svelte generated by Svelte v3.18.1 */

  function create_else_block$1(ctx) {
  	let label;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[13].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[12], null);

  	let label_levels = [
  		{
  			class: "mdc-floating-label " + /*className*/ ctx[1]
  		},
  		/*forId*/ ctx[2] || /*inputProps*/ ctx[6] && /*inputProps*/ ctx[6].id
  		? {
  				"for": /*forId*/ ctx[2] || /*inputProps*/ ctx[6] && /*inputProps*/ ctx[6].id
  			}
  		: {},
  		exclude(/*$$props*/ ctx[7], ["use", "class", "for", "wrapped"])
  	];

  	let label_data = {};

  	for (let i = 0; i < label_levels.length; i += 1) {
  		label_data = assign(label_data, label_levels[i]);
  	}

  	return {
  		c() {
  			label = element("label");
  			if (default_slot) default_slot.c();
  			set_attributes(label, label_data);
  		},
  		m(target, anchor) {
  			insert(target, label, anchor);

  			if (default_slot) {
  				default_slot.m(label, null);
  			}

  			/*label_binding*/ ctx[15](label);
  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, label, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[5].call(null, label))
  			];
  		},
  		p(ctx, dirty) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 4096) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[12], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[12], dirty, null));
  			}

  			set_attributes(label, get_spread_update(label_levels, [
  				dirty & /*className*/ 2 && {
  					class: "mdc-floating-label " + /*className*/ ctx[1]
  				},
  				dirty & /*forId, inputProps*/ 68 && (/*forId*/ ctx[2] || /*inputProps*/ ctx[6] && /*inputProps*/ ctx[6].id
  				? {
  						"for": /*forId*/ ctx[2] || /*inputProps*/ ctx[6] && /*inputProps*/ ctx[6].id
  					}
  				: {}),
  				dirty & /*exclude, $$props*/ 128 && exclude(/*$$props*/ ctx[7], ["use", "class", "for", "wrapped"])
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
  			if (detaching) detach(label);
  			if (default_slot) default_slot.d(detaching);
  			/*label_binding*/ ctx[15](null);
  			run_all(dispose);
  		}
  	};
  }

  // (1:0) {#if wrapped}
  function create_if_block$1(ctx) {
  	let span;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[13].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[12], null);

  	let span_levels = [
  		{
  			class: "mdc-floating-label " + /*className*/ ctx[1]
  		},
  		exclude(/*$$props*/ ctx[7], ["use", "class", "wrapped"])
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

  			/*span_binding*/ ctx[14](span);
  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, span, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[5].call(null, span))
  			];
  		},
  		p(ctx, dirty) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 4096) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[12], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[12], dirty, null));
  			}

  			set_attributes(span, get_spread_update(span_levels, [
  				dirty & /*className*/ 2 && {
  					class: "mdc-floating-label " + /*className*/ ctx[1]
  				},
  				dirty & /*exclude, $$props*/ 128 && exclude(/*$$props*/ ctx[7], ["use", "class", "wrapped"])
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
  			/*span_binding*/ ctx[14](null);
  			run_all(dispose);
  		}
  	};
  }

  function create_fragment$d(ctx) {
  	let current_block_type_index;
  	let if_block;
  	let if_block_anchor;
  	let current;
  	const if_block_creators = [create_if_block$1, create_else_block$1];
  	const if_blocks = [];

  	function select_block_type(ctx, dirty) {
  		if (/*wrapped*/ ctx[3]) return 0;
  		return 1;
  	}

  	current_block_type_index = select_block_type(ctx);
  	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

  	return {
  		c() {
  			if_block.c();
  			if_block_anchor = empty();
  		},
  		m(target, anchor) {
  			if_blocks[current_block_type_index].m(target, anchor);
  			insert(target, if_block_anchor, anchor);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			let previous_block_index = current_block_type_index;
  			current_block_type_index = select_block_type(ctx);

  			if (current_block_type_index === previous_block_index) {
  				if_blocks[current_block_type_index].p(ctx, dirty);
  			} else {
  				group_outros();

  				transition_out(if_blocks[previous_block_index], 1, 1, () => {
  					if_blocks[previous_block_index] = null;
  				});

  				check_outros();
  				if_block = if_blocks[current_block_type_index];

  				if (!if_block) {
  					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
  					if_block.c();
  				}

  				transition_in(if_block, 1);
  				if_block.m(if_block_anchor.parentNode, if_block_anchor);
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(if_block);
  			current = true;
  		},
  		o(local) {
  			transition_out(if_block);
  			current = false;
  		},
  		d(detaching) {
  			if_blocks[current_block_type_index].d(detaching);
  			if (detaching) detach(if_block_anchor);
  		}
  	};
  }

  function instance$d($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { for: forId = "" } = $$props;
  	let { wrapped = false } = $$props;
  	let element;
  	let floatingLabel;
  	let inputProps = getContext("SMUI:generic:input:props") || {};

  	onMount(() => {
  		floatingLabel = new MDCFloatingLabel(element);
  	});

  	onDestroy(() => {
  		floatingLabel && floatingLabel.destroy();
  	});

  	function shake(shouldShake, ...args) {
  		return floatingLabel.shake(shouldShake, ...args);
  	}

  	function float(shouldFloat, ...args) {
  		return floatingLabel.float(shouldFloat, ...args);
  	}

  	function getWidth(...args) {
  		return floatingLabel.getWidth(...args);
  	}

  	let { $$slots = {}, $$scope } = $$props;

  	function span_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(4, element = $$value);
  		});
  	}

  	function label_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(4, element = $$value);
  		});
  	}

  	$$self.$set = $$new_props => {
  		$$invalidate(7, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("for" in $$new_props) $$invalidate(2, forId = $$new_props.for);
  		if ("wrapped" in $$new_props) $$invalidate(3, wrapped = $$new_props.wrapped);
  		if ("$$scope" in $$new_props) $$invalidate(12, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		forId,
  		wrapped,
  		element,
  		forwardEvents,
  		inputProps,
  		$$props,
  		shake,
  		float,
  		getWidth,
  		floatingLabel,
  		$$scope,
  		$$slots,
  		span_binding,
  		label_binding
  	];
  }

  class FloatingLabel extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$d, create_fragment$d, safe_not_equal, {
  			use: 0,
  			class: 1,
  			for: 2,
  			wrapped: 3,
  			shake: 8,
  			float: 9,
  			getWidth: 10
  		});
  	}

  	get shake() {
  		return this.$$.ctx[8];
  	}

  	get float() {
  		return this.$$.ctx[9];
  	}

  	get getWidth() {
  		return this.$$.ctx[10];
  	}
  }

  /* node_modules\@smui\line-ripple\LineRipple.svelte generated by Svelte v3.18.1 */

  function create_fragment$e(ctx) {
  	let div;
  	let useActions_action;
  	let forwardEvents_action;
  	let dispose;

  	let div_levels = [
  		{
  			class: "\n    mdc-line-ripple\n    " + /*className*/ ctx[1] + "\n    " + (/*active*/ ctx[2] ? "mdc-line-ripple--active" : "") + "\n  "
  		},
  		exclude(/*$$props*/ ctx[5], ["use", "class", "active"])
  	];

  	let div_data = {};

  	for (let i = 0; i < div_levels.length; i += 1) {
  		div_data = assign(div_data, div_levels[i]);
  	}

  	return {
  		c() {
  			div = element("div");
  			set_attributes(div, div_data);
  		},
  		m(target, anchor) {
  			insert(target, div, anchor);
  			/*div_binding*/ ctx[10](div);

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, div, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[4].call(null, div))
  			];
  		},
  		p(ctx, [dirty]) {
  			set_attributes(div, get_spread_update(div_levels, [
  				dirty & /*className, active*/ 6 && {
  					class: "\n    mdc-line-ripple\n    " + /*className*/ ctx[1] + "\n    " + (/*active*/ ctx[2] ? "mdc-line-ripple--active" : "") + "\n  "
  				},
  				dirty & /*exclude, $$props*/ 32 && exclude(/*$$props*/ ctx[5], ["use", "class", "active"])
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		i: noop,
  		o: noop,
  		d(detaching) {
  			if (detaching) detach(div);
  			/*div_binding*/ ctx[10](null);
  			run_all(dispose);
  		}
  	};
  }

  function instance$e($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { active = false } = $$props;
  	let element;
  	let lineRipple;

  	onMount(() => {
  		lineRipple = new MDCLineRipple(element);
  	});

  	onDestroy(() => {
  		lineRipple && lineRipple.destroy();
  	});

  	function activate(...args) {
  		return lineRipple.activate(...args);
  	}

  	function deactivate(...args) {
  		return lineRipple.deactivate(...args);
  	}

  	function setRippleCenter(xCoordinate, ...args) {
  		return lineRipple.setRippleCenter(xCoordinate, ...args);
  	}

  	function div_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(3, element = $$value);
  		});
  	}

  	$$self.$set = $$new_props => {
  		$$invalidate(5, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("active" in $$new_props) $$invalidate(2, active = $$new_props.active);
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		active,
  		element,
  		forwardEvents,
  		$$props,
  		activate,
  		deactivate,
  		setRippleCenter,
  		lineRipple,
  		div_binding
  	];
  }

  class LineRipple extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$e, create_fragment$e, safe_not_equal, {
  			use: 0,
  			class: 1,
  			active: 2,
  			activate: 6,
  			deactivate: 7,
  			setRippleCenter: 8
  		});
  	}

  	get activate() {
  		return this.$$.ctx[6];
  	}

  	get deactivate() {
  		return this.$$.ctx[7];
  	}

  	get setRippleCenter() {
  		return this.$$.ctx[8];
  	}
  }

  /* node_modules\@smui\notched-outline\NotchedOutline.svelte generated by Svelte v3.18.1 */

  function create_if_block$2(ctx) {
  	let div;
  	let current;
  	const default_slot_template = /*$$slots*/ ctx[11].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[10], null);

  	return {
  		c() {
  			div = element("div");
  			if (default_slot) default_slot.c();
  			attr(div, "class", "mdc-notched-outline__notch");
  		},
  		m(target, anchor) {
  			insert(target, div, anchor);

  			if (default_slot) {
  				default_slot.m(div, null);
  			}

  			current = true;
  		},
  		p(ctx, dirty) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 1024) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[10], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[10], dirty, null));
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
  			if (detaching) detach(div);
  			if (default_slot) default_slot.d(detaching);
  		}
  	};
  }

  function create_fragment$f(ctx) {
  	let div2;
  	let div0;
  	let t0;
  	let t1;
  	let div1;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	let if_block = !/*noLabel*/ ctx[3] && create_if_block$2(ctx);

  	let div2_levels = [
  		{
  			class: "\n    mdc-notched-outline\n    " + /*className*/ ctx[1] + "\n    " + (/*notched*/ ctx[2] ? "mdc-notched-outline--notched" : "") + "\n    " + (/*noLabel*/ ctx[3]
  			? "mdc-notched-outline--no-label"
  			: "") + "\n  "
  		},
  		exclude(/*$$props*/ ctx[6], ["use", "class", "notched", "noLabel"])
  	];

  	let div2_data = {};

  	for (let i = 0; i < div2_levels.length; i += 1) {
  		div2_data = assign(div2_data, div2_levels[i]);
  	}

  	return {
  		c() {
  			div2 = element("div");
  			div0 = element("div");
  			t0 = space();
  			if (if_block) if_block.c();
  			t1 = space();
  			div1 = element("div");
  			attr(div0, "class", "mdc-notched-outline__leading");
  			attr(div1, "class", "mdc-notched-outline__trailing");
  			set_attributes(div2, div2_data);
  		},
  		m(target, anchor) {
  			insert(target, div2, anchor);
  			append(div2, div0);
  			append(div2, t0);
  			if (if_block) if_block.m(div2, null);
  			append(div2, t1);
  			append(div2, div1);
  			/*div2_binding*/ ctx[12](div2);
  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, div2, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[5].call(null, div2))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (!/*noLabel*/ ctx[3]) {
  				if (if_block) {
  					if_block.p(ctx, dirty);
  					transition_in(if_block, 1);
  				} else {
  					if_block = create_if_block$2(ctx);
  					if_block.c();
  					transition_in(if_block, 1);
  					if_block.m(div2, t1);
  				}
  			} else if (if_block) {
  				group_outros();

  				transition_out(if_block, 1, 1, () => {
  					if_block = null;
  				});

  				check_outros();
  			}

  			set_attributes(div2, get_spread_update(div2_levels, [
  				dirty & /*className, notched, noLabel*/ 14 && {
  					class: "\n    mdc-notched-outline\n    " + /*className*/ ctx[1] + "\n    " + (/*notched*/ ctx[2] ? "mdc-notched-outline--notched" : "") + "\n    " + (/*noLabel*/ ctx[3]
  					? "mdc-notched-outline--no-label"
  					: "") + "\n  "
  				},
  				dirty & /*exclude, $$props*/ 64 && exclude(/*$$props*/ ctx[6], ["use", "class", "notched", "noLabel"])
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(if_block);
  			current = true;
  		},
  		o(local) {
  			transition_out(if_block);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div2);
  			if (if_block) if_block.d();
  			/*div2_binding*/ ctx[12](null);
  			run_all(dispose);
  		}
  	};
  }

  function instance$f($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { notched = false } = $$props;
  	let { noLabel = false } = $$props;
  	let element;
  	let notchedOutline;

  	onMount(() => {
  		notchedOutline = new MDCNotchedOutline(element);
  	});

  	onDestroy(() => {
  		notchedOutline && notchedOutline.destroy();
  	});

  	function notch(notchWidth, ...args) {
  		return notchedOutline.notch(notchWidth, ...args);
  	}

  	function closeNotch(...args) {
  		return notchedOutline.closeNotch(...args);
  	}

  	let { $$slots = {}, $$scope } = $$props;

  	function div2_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(4, element = $$value);
  		});
  	}

  	$$self.$set = $$new_props => {
  		$$invalidate(6, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("notched" in $$new_props) $$invalidate(2, notched = $$new_props.notched);
  		if ("noLabel" in $$new_props) $$invalidate(3, noLabel = $$new_props.noLabel);
  		if ("$$scope" in $$new_props) $$invalidate(10, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		notched,
  		noLabel,
  		element,
  		forwardEvents,
  		$$props,
  		notch,
  		closeNotch,
  		notchedOutline,
  		$$scope,
  		$$slots,
  		div2_binding
  	];
  }

  class NotchedOutline extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$f, create_fragment$f, safe_not_equal, {
  			use: 0,
  			class: 1,
  			notched: 2,
  			noLabel: 3,
  			notch: 7,
  			closeNotch: 8
  		});
  	}

  	get notch() {
  		return this.$$.ctx[7];
  	}

  	get closeNotch() {
  		return this.$$.ctx[8];
  	}
  }

  /* node_modules\@smui\textfield\Input.svelte generated by Svelte v3.18.1 */

  function create_fragment$g(ctx) {
  	let input;
  	let useActions_action;
  	let forwardEvents_action;
  	let dispose;

  	let input_levels = [
  		{
  			class: "mdc-text-field__input " + /*className*/ ctx[1]
  		},
  		{ type: /*type*/ ctx[2] },
  		/*valueProp*/ ctx[4],
  		exclude(/*$$props*/ ctx[8], [
  			"use",
  			"class",
  			"type",
  			"value",
  			"files",
  			"dirty",
  			"invalid",
  			"updateInvalid"
  		])
  	];

  	let input_data = {};

  	for (let i = 0; i < input_levels.length; i += 1) {
  		input_data = assign(input_data, input_levels[i]);
  	}

  	return {
  		c() {
  			input = element("input");
  			set_attributes(input, input_data);
  		},
  		m(target, anchor) {
  			insert(target, input, anchor);
  			/*input_binding*/ ctx[14](input);

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, input, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[5].call(null, input)),
  				listen(input, "change", /*change_handler*/ ctx[15]),
  				listen(input, "input", /*input_handler*/ ctx[16]),
  				listen(input, "change", /*changeHandler*/ ctx[7])
  			];
  		},
  		p(ctx, [dirty]) {
  			set_attributes(input, get_spread_update(input_levels, [
  				dirty & /*className*/ 2 && {
  					class: "mdc-text-field__input " + /*className*/ ctx[1]
  				},
  				dirty & /*type*/ 4 && { type: /*type*/ ctx[2] },
  				dirty & /*valueProp*/ 16 && /*valueProp*/ ctx[4],
  				dirty & /*exclude, $$props*/ 256 && exclude(/*$$props*/ ctx[8], [
  					"use",
  					"class",
  					"type",
  					"value",
  					"files",
  					"dirty",
  					"invalid",
  					"updateInvalid"
  				])
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		i: noop,
  		o: noop,
  		d(detaching) {
  			if (detaching) detach(input);
  			/*input_binding*/ ctx[14](null);
  			run_all(dispose);
  		}
  	};
  }

  function toNumber(value) {
  	if (value === "") {
  		const nan = new Number(Number.NaN);
  		nan.length = 0;
  		return nan;
  	}

  	return +value;
  }

  function instance$g($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component, ["change", "input"]);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { type = "text" } = $$props;
  	let { value = "" } = $$props;
  	let { files = undefined } = $$props;
  	let { dirty = false } = $$props;
  	let { invalid = false } = $$props;
  	let { updateInvalid = true } = $$props;
  	let element;
  	let valueProp = {};

  	onMount(() => {
  		if (updateInvalid) {
  			$$invalidate(12, invalid = element.matches(":invalid"));
  		}
  	});

  	function valueUpdater(e) {
  		switch (type) {
  			case "number":
  			case "range":
  				$$invalidate(9, value = toNumber(e.target.value));
  				break;
  			case "file":
  				$$invalidate(10, files = e.target.files);
  			default:
  				$$invalidate(9, value = e.target.value);
  				break;
  		}
  	}

  	function changeHandler(e) {
  		$$invalidate(11, dirty = true);

  		if (updateInvalid) {
  			$$invalidate(12, invalid = element.matches(":invalid"));
  		}
  	}

  	function input_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(3, element = $$value);
  		});
  	}

  	const change_handler = e => (type === "file" || type === "range") && valueUpdater(e);
  	const input_handler = e => type !== "file" && valueUpdater(e);

  	$$self.$set = $$new_props => {
  		$$invalidate(8, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("type" in $$new_props) $$invalidate(2, type = $$new_props.type);
  		if ("value" in $$new_props) $$invalidate(9, value = $$new_props.value);
  		if ("files" in $$new_props) $$invalidate(10, files = $$new_props.files);
  		if ("dirty" in $$new_props) $$invalidate(11, dirty = $$new_props.dirty);
  		if ("invalid" in $$new_props) $$invalidate(12, invalid = $$new_props.invalid);
  		if ("updateInvalid" in $$new_props) $$invalidate(13, updateInvalid = $$new_props.updateInvalid);
  	};

  	$$self.$$.update = () => {
  		if ($$self.$$.dirty & /*type, valueProp, value*/ 532) {
  			 if (type === "file") {
  				delete valueProp.value;
  			} else {
  				$$invalidate(4, valueProp.value = value === undefined ? "" : value, valueProp);
  			}
  		}
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		type,
  		element,
  		valueProp,
  		forwardEvents,
  		valueUpdater,
  		changeHandler,
  		$$props,
  		value,
  		files,
  		dirty,
  		invalid,
  		updateInvalid,
  		input_binding,
  		change_handler,
  		input_handler
  	];
  }

  class Input extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$g, create_fragment$g, safe_not_equal, {
  			use: 0,
  			class: 1,
  			type: 2,
  			value: 9,
  			files: 10,
  			dirty: 11,
  			invalid: 12,
  			updateInvalid: 13
  		});
  	}
  }

  /* node_modules\@smui\textfield\Textarea.svelte generated by Svelte v3.18.1 */

  function create_fragment$h(ctx) {
  	let textarea;
  	let useActions_action;
  	let forwardEvents_action;
  	let dispose;

  	let textarea_levels = [
  		{
  			class: "mdc-text-field__input " + /*className*/ ctx[2]
  		},
  		exclude(/*$$props*/ ctx[6], ["use", "class", "value", "dirty", "invalid", "updateInvalid"])
  	];

  	let textarea_data = {};

  	for (let i = 0; i < textarea_levels.length; i += 1) {
  		textarea_data = assign(textarea_data, textarea_levels[i]);
  	}

  	return {
  		c() {
  			textarea = element("textarea");
  			set_attributes(textarea, textarea_data);
  		},
  		m(target, anchor) {
  			insert(target, textarea, anchor);
  			/*textarea_binding*/ ctx[10](textarea);
  			set_input_value(textarea, /*value*/ ctx[0]);

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, textarea, /*use*/ ctx[1])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[4].call(null, textarea)),
  				listen(textarea, "input", /*textarea_input_handler*/ ctx[11]),
  				listen(textarea, "change", /*changeHandler*/ ctx[5])
  			];
  		},
  		p(ctx, [dirty]) {
  			set_attributes(textarea, get_spread_update(textarea_levels, [
  				dirty & /*className*/ 4 && {
  					class: "mdc-text-field__input " + /*className*/ ctx[2]
  				},
  				dirty & /*exclude, $$props*/ 64 && exclude(/*$$props*/ ctx[6], ["use", "class", "value", "dirty", "invalid", "updateInvalid"])
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 2) useActions_action.update.call(null, /*use*/ ctx[1]);

  			if (dirty & /*value*/ 1) {
  				set_input_value(textarea, /*value*/ ctx[0]);
  			}
  		},
  		i: noop,
  		o: noop,
  		d(detaching) {
  			if (detaching) detach(textarea);
  			/*textarea_binding*/ ctx[10](null);
  			run_all(dispose);
  		}
  	};
  }

  function instance$h($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component, ["change", "input"]);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { value = "" } = $$props;
  	let { dirty = false } = $$props;
  	let { invalid = false } = $$props;
  	let { updateInvalid = true } = $$props;
  	let element;

  	onMount(() => {
  		if (updateInvalid) {
  			$$invalidate(8, invalid = element.matches(":invalid"));
  		}
  	});

  	function changeHandler() {
  		$$invalidate(7, dirty = true);

  		if (updateInvalid) {
  			$$invalidate(8, invalid = element.matches(":invalid"));
  		}
  	}

  	function textarea_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(3, element = $$value);
  		});
  	}

  	function textarea_input_handler() {
  		value = this.value;
  		$$invalidate(0, value);
  	}

  	$$self.$set = $$new_props => {
  		$$invalidate(6, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(1, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(2, className = $$new_props.class);
  		if ("value" in $$new_props) $$invalidate(0, value = $$new_props.value);
  		if ("dirty" in $$new_props) $$invalidate(7, dirty = $$new_props.dirty);
  		if ("invalid" in $$new_props) $$invalidate(8, invalid = $$new_props.invalid);
  		if ("updateInvalid" in $$new_props) $$invalidate(9, updateInvalid = $$new_props.updateInvalid);
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		value,
  		use,
  		className,
  		element,
  		forwardEvents,
  		changeHandler,
  		$$props,
  		dirty,
  		invalid,
  		updateInvalid,
  		textarea_binding,
  		textarea_input_handler
  	];
  }

  class Textarea extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$h, create_fragment$h, safe_not_equal, {
  			use: 1,
  			class: 2,
  			value: 0,
  			dirty: 7,
  			invalid: 8,
  			updateInvalid: 9
  		});
  	}
  }

  /* node_modules\@smui\textfield\Textfield.svelte generated by Svelte v3.18.1 */
  const get_label_slot_changes_1 = dirty => ({});
  const get_label_slot_context_1 = ctx => ({});
  const get_label_slot_changes$1 = dirty => ({});
  const get_label_slot_context$1 = ctx => ({});

  // (65:0) {:else}
  function create_else_block_1(ctx) {
  	let div;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[30].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[44], null);

  	let div_levels = [
  		{
  			class: "\n      mdc-text-field\n      " + /*className*/ ctx[5] + "\n      " + (/*disabled*/ ctx[7] ? "mdc-text-field--disabled" : "") + "\n      " + (/*fullwidth*/ ctx[8] ? "mdc-text-field--fullwidth" : "") + "\n      " + (/*textarea*/ ctx[9] ? "mdc-text-field--textarea" : "") + "\n      " + (/*variant*/ ctx[10] === "outlined" && !/*fullwidth*/ ctx[8]
  			? "mdc-text-field--outlined"
  			: "") + "\n      " + (/*variant*/ ctx[10] === "standard" && !/*fullwidth*/ ctx[8] && !/*textarea*/ ctx[9]
  			? "smui-text-field--standard"
  			: "") + "\n      " + (/*dense*/ ctx[11] ? "mdc-text-field--dense" : "") + "\n      " + (/*noLabel*/ ctx[14] ? "mdc-text-field--no-label" : "") + "\n      " + (/*withLeadingIcon*/ ctx[12]
  			? "mdc-text-field--with-leading-icon"
  			: "") + "\n      " + (/*withTrailingIcon*/ ctx[13]
  			? "mdc-text-field--with-trailing-icon"
  			: "") + "\n      " + (/*invalid*/ ctx[3] ? "mdc-text-field--invalid" : "") + "\n    "
  		},
  		/*props*/ ctx[19]
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

  			/*div_binding*/ ctx[43](div);
  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, div, /*use*/ ctx[4])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[21].call(null, div))
  			];
  		},
  		p(ctx, dirty) {
  			if (default_slot && default_slot.p && dirty[1] & /*$$scope*/ 8192) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[44], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[44], dirty, null));
  			}

  			set_attributes(div, get_spread_update(div_levels, [
  				dirty[0] & /*className, disabled, fullwidth, textarea, variant, dense, noLabel, withLeadingIcon, withTrailingIcon, invalid*/ 32680 && {
  					class: "\n      mdc-text-field\n      " + /*className*/ ctx[5] + "\n      " + (/*disabled*/ ctx[7] ? "mdc-text-field--disabled" : "") + "\n      " + (/*fullwidth*/ ctx[8] ? "mdc-text-field--fullwidth" : "") + "\n      " + (/*textarea*/ ctx[9] ? "mdc-text-field--textarea" : "") + "\n      " + (/*variant*/ ctx[10] === "outlined" && !/*fullwidth*/ ctx[8]
  					? "mdc-text-field--outlined"
  					: "") + "\n      " + (/*variant*/ ctx[10] === "standard" && !/*fullwidth*/ ctx[8] && !/*textarea*/ ctx[9]
  					? "smui-text-field--standard"
  					: "") + "\n      " + (/*dense*/ ctx[11] ? "mdc-text-field--dense" : "") + "\n      " + (/*noLabel*/ ctx[14] ? "mdc-text-field--no-label" : "") + "\n      " + (/*withLeadingIcon*/ ctx[12]
  					? "mdc-text-field--with-leading-icon"
  					: "") + "\n      " + (/*withTrailingIcon*/ ctx[13]
  					? "mdc-text-field--with-trailing-icon"
  					: "") + "\n      " + (/*invalid*/ ctx[3] ? "mdc-text-field--invalid" : "") + "\n    "
  				},
  				dirty[0] & /*props*/ 524288 && /*props*/ ctx[19]
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty[0] & /*use*/ 16) useActions_action.update.call(null, /*use*/ ctx[4]);
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
  			/*div_binding*/ ctx[43](null);
  			run_all(dispose);
  		}
  	};
  }

  // (1:0) {#if valued}
  function create_if_block$3(ctx) {
  	let label_1;
  	let t0;
  	let current_block_type_index;
  	let if_block0;
  	let t1;
  	let t2;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[30].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[44], null);
  	const if_block_creators = [create_if_block_6, create_else_block$2];
  	const if_blocks = [];

  	function select_block_type_1(ctx, dirty) {
  		if (/*textarea*/ ctx[9]) return 0;
  		return 1;
  	}

  	current_block_type_index = select_block_type_1(ctx);
  	if_block0 = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
  	let if_block1 = !/*textarea*/ ctx[9] && /*variant*/ ctx[10] !== "outlined" && create_if_block_3(ctx);
  	let if_block2 = (/*textarea*/ ctx[9] || /*variant*/ ctx[10] === "outlined" && !/*fullwidth*/ ctx[8]) && create_if_block_1(ctx);

  	let label_1_levels = [
  		{
  			class: "\n      mdc-text-field\n      " + /*className*/ ctx[5] + "\n      " + (/*disabled*/ ctx[7] ? "mdc-text-field--disabled" : "") + "\n      " + (/*fullwidth*/ ctx[8] ? "mdc-text-field--fullwidth" : "") + "\n      " + (/*textarea*/ ctx[9] ? "mdc-text-field--textarea" : "") + "\n      " + (/*variant*/ ctx[10] === "outlined" && !/*fullwidth*/ ctx[8]
  			? "mdc-text-field--outlined"
  			: "") + "\n      " + (/*variant*/ ctx[10] === "standard" && !/*fullwidth*/ ctx[8] && !/*textarea*/ ctx[9]
  			? "smui-text-field--standard"
  			: "") + "\n      " + (/*dense*/ ctx[11] ? "mdc-text-field--dense" : "") + "\n      " + (/*noLabel*/ ctx[14] || /*label*/ ctx[15] == null
  			? "mdc-text-field--no-label"
  			: "") + "\n      " + (/*withLeadingIcon*/ ctx[12]
  			? "mdc-text-field--with-leading-icon"
  			: "") + "\n      " + (/*withTrailingIcon*/ ctx[13]
  			? "mdc-text-field--with-trailing-icon"
  			: "") + "\n      " + (/*invalid*/ ctx[3] ? "mdc-text-field--invalid" : "") + "\n    "
  		},
  		/*props*/ ctx[19]
  	];

  	let label_1_data = {};

  	for (let i = 0; i < label_1_levels.length; i += 1) {
  		label_1_data = assign(label_1_data, label_1_levels[i]);
  	}

  	return {
  		c() {
  			label_1 = element("label");
  			if (default_slot) default_slot.c();
  			t0 = space();
  			if_block0.c();
  			t1 = space();
  			if (if_block1) if_block1.c();
  			t2 = space();
  			if (if_block2) if_block2.c();
  			set_attributes(label_1, label_1_data);
  		},
  		m(target, anchor) {
  			insert(target, label_1, anchor);

  			if (default_slot) {
  				default_slot.m(label_1, null);
  			}

  			append(label_1, t0);
  			if_blocks[current_block_type_index].m(label_1, null);
  			append(label_1, t1);
  			if (if_block1) if_block1.m(label_1, null);
  			append(label_1, t2);
  			if (if_block2) if_block2.m(label_1, null);
  			/*label_1_binding*/ ctx[42](label_1);
  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, label_1, /*use*/ ctx[4])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[21].call(null, label_1))
  			];
  		},
  		p(ctx, dirty) {
  			if (default_slot && default_slot.p && dirty[1] & /*$$scope*/ 8192) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[44], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[44], dirty, null));
  			}

  			let previous_block_index = current_block_type_index;
  			current_block_type_index = select_block_type_1(ctx);

  			if (current_block_type_index === previous_block_index) {
  				if_blocks[current_block_type_index].p(ctx, dirty);
  			} else {
  				group_outros();

  				transition_out(if_blocks[previous_block_index], 1, 1, () => {
  					if_blocks[previous_block_index] = null;
  				});

  				check_outros();
  				if_block0 = if_blocks[current_block_type_index];

  				if (!if_block0) {
  					if_block0 = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
  					if_block0.c();
  				}

  				transition_in(if_block0, 1);
  				if_block0.m(label_1, t1);
  			}

  			if (!/*textarea*/ ctx[9] && /*variant*/ ctx[10] !== "outlined") {
  				if (if_block1) {
  					if_block1.p(ctx, dirty);
  					transition_in(if_block1, 1);
  				} else {
  					if_block1 = create_if_block_3(ctx);
  					if_block1.c();
  					transition_in(if_block1, 1);
  					if_block1.m(label_1, t2);
  				}
  			} else if (if_block1) {
  				group_outros();

  				transition_out(if_block1, 1, 1, () => {
  					if_block1 = null;
  				});

  				check_outros();
  			}

  			if (/*textarea*/ ctx[9] || /*variant*/ ctx[10] === "outlined" && !/*fullwidth*/ ctx[8]) {
  				if (if_block2) {
  					if_block2.p(ctx, dirty);
  					transition_in(if_block2, 1);
  				} else {
  					if_block2 = create_if_block_1(ctx);
  					if_block2.c();
  					transition_in(if_block2, 1);
  					if_block2.m(label_1, null);
  				}
  			} else if (if_block2) {
  				group_outros();

  				transition_out(if_block2, 1, 1, () => {
  					if_block2 = null;
  				});

  				check_outros();
  			}

  			set_attributes(label_1, get_spread_update(label_1_levels, [
  				dirty[0] & /*className, disabled, fullwidth, textarea, variant, dense, noLabel, label, withLeadingIcon, withTrailingIcon, invalid*/ 65448 && {
  					class: "\n      mdc-text-field\n      " + /*className*/ ctx[5] + "\n      " + (/*disabled*/ ctx[7] ? "mdc-text-field--disabled" : "") + "\n      " + (/*fullwidth*/ ctx[8] ? "mdc-text-field--fullwidth" : "") + "\n      " + (/*textarea*/ ctx[9] ? "mdc-text-field--textarea" : "") + "\n      " + (/*variant*/ ctx[10] === "outlined" && !/*fullwidth*/ ctx[8]
  					? "mdc-text-field--outlined"
  					: "") + "\n      " + (/*variant*/ ctx[10] === "standard" && !/*fullwidth*/ ctx[8] && !/*textarea*/ ctx[9]
  					? "smui-text-field--standard"
  					: "") + "\n      " + (/*dense*/ ctx[11] ? "mdc-text-field--dense" : "") + "\n      " + (/*noLabel*/ ctx[14] || /*label*/ ctx[15] == null
  					? "mdc-text-field--no-label"
  					: "") + "\n      " + (/*withLeadingIcon*/ ctx[12]
  					? "mdc-text-field--with-leading-icon"
  					: "") + "\n      " + (/*withTrailingIcon*/ ctx[13]
  					? "mdc-text-field--with-trailing-icon"
  					: "") + "\n      " + (/*invalid*/ ctx[3] ? "mdc-text-field--invalid" : "") + "\n    "
  				},
  				dirty[0] & /*props*/ 524288 && /*props*/ ctx[19]
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty[0] & /*use*/ 16) useActions_action.update.call(null, /*use*/ ctx[4]);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(default_slot, local);
  			transition_in(if_block0);
  			transition_in(if_block1);
  			transition_in(if_block2);
  			current = true;
  		},
  		o(local) {
  			transition_out(default_slot, local);
  			transition_out(if_block0);
  			transition_out(if_block1);
  			transition_out(if_block2);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(label_1);
  			if (default_slot) default_slot.d(detaching);
  			if_blocks[current_block_type_index].d();
  			if (if_block1) if_block1.d();
  			if (if_block2) if_block2.d();
  			/*label_1_binding*/ ctx[42](null);
  			run_all(dispose);
  		}
  	};
  }

  // (34:4) {:else}
  function create_else_block$2(ctx) {
  	let updating_value;
  	let updating_files;
  	let updating_dirty;
  	let updating_invalid;
  	let current;

  	const input_spread_levels = [
  		{ type: /*type*/ ctx[16] },
  		{ disabled: /*disabled*/ ctx[7] },
  		{ updateInvalid: /*updateInvalid*/ ctx[17] },
  		/*fullwidth*/ ctx[8] && /*label*/ ctx[15]
  		? { placeholder: /*label*/ ctx[15] }
  		: {},
  		prefixFilter(/*$$props*/ ctx[22], "input$")
  	];

  	function input_value_binding(value_1) {
  		/*input_value_binding*/ ctx[36].call(null, value_1);
  	}

  	function input_files_binding(value_2) {
  		/*input_files_binding*/ ctx[37].call(null, value_2);
  	}

  	function input_dirty_binding(value_3) {
  		/*input_dirty_binding*/ ctx[38].call(null, value_3);
  	}

  	function input_invalid_binding(value_4) {
  		/*input_invalid_binding*/ ctx[39].call(null, value_4);
  	}

  	let input_props = {};

  	for (let i = 0; i < input_spread_levels.length; i += 1) {
  		input_props = assign(input_props, input_spread_levels[i]);
  	}

  	if (/*value*/ ctx[0] !== void 0) {
  		input_props.value = /*value*/ ctx[0];
  	}

  	if (/*files*/ ctx[1] !== void 0) {
  		input_props.files = /*files*/ ctx[1];
  	}

  	if (/*dirty*/ ctx[2] !== void 0) {
  		input_props.dirty = /*dirty*/ ctx[2];
  	}

  	if (/*invalid*/ ctx[3] !== void 0) {
  		input_props.invalid = /*invalid*/ ctx[3];
  	}

  	const input = new Input({ props: input_props });
  	binding_callbacks.push(() => bind(input, "value", input_value_binding));
  	binding_callbacks.push(() => bind(input, "files", input_files_binding));
  	binding_callbacks.push(() => bind(input, "dirty", input_dirty_binding));
  	binding_callbacks.push(() => bind(input, "invalid", input_invalid_binding));
  	input.$on("change", /*change_handler_1*/ ctx[40]);
  	input.$on("input", /*input_handler_1*/ ctx[41]);

  	return {
  		c() {
  			create_component(input.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(input, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const input_changes = (dirty[0] & /*type, disabled, updateInvalid, fullwidth, label, $$props*/ 4424064)
  			? get_spread_update(input_spread_levels, [
  					dirty[0] & /*type*/ 65536 && { type: /*type*/ ctx[16] },
  					dirty[0] & /*disabled*/ 128 && { disabled: /*disabled*/ ctx[7] },
  					dirty[0] & /*updateInvalid*/ 131072 && { updateInvalid: /*updateInvalid*/ ctx[17] },
  					dirty[0] & /*fullwidth, label*/ 33024 && get_spread_object(/*fullwidth*/ ctx[8] && /*label*/ ctx[15]
  					? { placeholder: /*label*/ ctx[15] }
  					: {}),
  					dirty[0] & /*$$props*/ 4194304 && get_spread_object(prefixFilter(/*$$props*/ ctx[22], "input$"))
  				])
  			: {};

  			if (!updating_value && dirty[0] & /*value*/ 1) {
  				updating_value = true;
  				input_changes.value = /*value*/ ctx[0];
  				add_flush_callback(() => updating_value = false);
  			}

  			if (!updating_files && dirty[0] & /*files*/ 2) {
  				updating_files = true;
  				input_changes.files = /*files*/ ctx[1];
  				add_flush_callback(() => updating_files = false);
  			}

  			if (!updating_dirty && dirty[0] & /*dirty*/ 4) {
  				updating_dirty = true;
  				input_changes.dirty = /*dirty*/ ctx[2];
  				add_flush_callback(() => updating_dirty = false);
  			}

  			if (!updating_invalid && dirty[0] & /*invalid*/ 8) {
  				updating_invalid = true;
  				input_changes.invalid = /*invalid*/ ctx[3];
  				add_flush_callback(() => updating_invalid = false);
  			}

  			input.$set(input_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(input.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(input.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(input, detaching);
  		}
  	};
  }

  // (23:4) {#if textarea}
  function create_if_block_6(ctx) {
  	let updating_value;
  	let updating_dirty;
  	let updating_invalid;
  	let current;

  	const textarea_1_spread_levels = [
  		{ disabled: /*disabled*/ ctx[7] },
  		{ updateInvalid: /*updateInvalid*/ ctx[17] },
  		prefixFilter(/*$$props*/ ctx[22], "input$")
  	];

  	function textarea_1_value_binding(value_1) {
  		/*textarea_1_value_binding*/ ctx[31].call(null, value_1);
  	}

  	function textarea_1_dirty_binding(value_2) {
  		/*textarea_1_dirty_binding*/ ctx[32].call(null, value_2);
  	}

  	function textarea_1_invalid_binding(value_3) {
  		/*textarea_1_invalid_binding*/ ctx[33].call(null, value_3);
  	}

  	let textarea_1_props = {};

  	for (let i = 0; i < textarea_1_spread_levels.length; i += 1) {
  		textarea_1_props = assign(textarea_1_props, textarea_1_spread_levels[i]);
  	}

  	if (/*value*/ ctx[0] !== void 0) {
  		textarea_1_props.value = /*value*/ ctx[0];
  	}

  	if (/*dirty*/ ctx[2] !== void 0) {
  		textarea_1_props.dirty = /*dirty*/ ctx[2];
  	}

  	if (/*invalid*/ ctx[3] !== void 0) {
  		textarea_1_props.invalid = /*invalid*/ ctx[3];
  	}

  	const textarea_1 = new Textarea({ props: textarea_1_props });
  	binding_callbacks.push(() => bind(textarea_1, "value", textarea_1_value_binding));
  	binding_callbacks.push(() => bind(textarea_1, "dirty", textarea_1_dirty_binding));
  	binding_callbacks.push(() => bind(textarea_1, "invalid", textarea_1_invalid_binding));
  	textarea_1.$on("change", /*change_handler*/ ctx[34]);
  	textarea_1.$on("input", /*input_handler*/ ctx[35]);

  	return {
  		c() {
  			create_component(textarea_1.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(textarea_1, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const textarea_1_changes = (dirty[0] & /*disabled, updateInvalid, $$props*/ 4325504)
  			? get_spread_update(textarea_1_spread_levels, [
  					dirty[0] & /*disabled*/ 128 && { disabled: /*disabled*/ ctx[7] },
  					dirty[0] & /*updateInvalid*/ 131072 && { updateInvalid: /*updateInvalid*/ ctx[17] },
  					dirty[0] & /*$$props*/ 4194304 && get_spread_object(prefixFilter(/*$$props*/ ctx[22], "input$"))
  				])
  			: {};

  			if (!updating_value && dirty[0] & /*value*/ 1) {
  				updating_value = true;
  				textarea_1_changes.value = /*value*/ ctx[0];
  				add_flush_callback(() => updating_value = false);
  			}

  			if (!updating_dirty && dirty[0] & /*dirty*/ 4) {
  				updating_dirty = true;
  				textarea_1_changes.dirty = /*dirty*/ ctx[2];
  				add_flush_callback(() => updating_dirty = false);
  			}

  			if (!updating_invalid && dirty[0] & /*invalid*/ 8) {
  				updating_invalid = true;
  				textarea_1_changes.invalid = /*invalid*/ ctx[3];
  				add_flush_callback(() => updating_invalid = false);
  			}

  			textarea_1.$set(textarea_1_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(textarea_1.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(textarea_1.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(textarea_1, detaching);
  		}
  	};
  }

  // (49:4) {#if !textarea && variant !== 'outlined'}
  function create_if_block_3(ctx) {
  	let t;
  	let if_block1_anchor;
  	let current;
  	let if_block0 = !/*noLabel*/ ctx[14] && /*label*/ ctx[15] != null && !/*fullwidth*/ ctx[8] && create_if_block_5(ctx);
  	let if_block1 = /*ripple*/ ctx[6] && create_if_block_4(ctx);

  	return {
  		c() {
  			if (if_block0) if_block0.c();
  			t = space();
  			if (if_block1) if_block1.c();
  			if_block1_anchor = empty();
  		},
  		m(target, anchor) {
  			if (if_block0) if_block0.m(target, anchor);
  			insert(target, t, anchor);
  			if (if_block1) if_block1.m(target, anchor);
  			insert(target, if_block1_anchor, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			if (!/*noLabel*/ ctx[14] && /*label*/ ctx[15] != null && !/*fullwidth*/ ctx[8]) {
  				if (if_block0) {
  					if_block0.p(ctx, dirty);
  					transition_in(if_block0, 1);
  				} else {
  					if_block0 = create_if_block_5(ctx);
  					if_block0.c();
  					transition_in(if_block0, 1);
  					if_block0.m(t.parentNode, t);
  				}
  			} else if (if_block0) {
  				group_outros();

  				transition_out(if_block0, 1, 1, () => {
  					if_block0 = null;
  				});

  				check_outros();
  			}

  			if (/*ripple*/ ctx[6]) {
  				if (if_block1) {
  					if_block1.p(ctx, dirty);
  					transition_in(if_block1, 1);
  				} else {
  					if_block1 = create_if_block_4(ctx);
  					if_block1.c();
  					transition_in(if_block1, 1);
  					if_block1.m(if_block1_anchor.parentNode, if_block1_anchor);
  				}
  			} else if (if_block1) {
  				group_outros();

  				transition_out(if_block1, 1, 1, () => {
  					if_block1 = null;
  				});

  				check_outros();
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(if_block0);
  			transition_in(if_block1);
  			current = true;
  		},
  		o(local) {
  			transition_out(if_block0);
  			transition_out(if_block1);
  			current = false;
  		},
  		d(detaching) {
  			if (if_block0) if_block0.d(detaching);
  			if (detaching) detach(t);
  			if (if_block1) if_block1.d(detaching);
  			if (detaching) detach(if_block1_anchor);
  		}
  	};
  }

  // (50:6) {#if !noLabel && label != null && !fullwidth}
  function create_if_block_5(ctx) {
  	let current;
  	const floatinglabel_spread_levels = [{ wrapped: true }, prefixFilter(/*$$props*/ ctx[22], "label$")];

  	let floatinglabel_props = {
  		$$slots: { default: [create_default_slot_2$1] },
  		$$scope: { ctx }
  	};

  	for (let i = 0; i < floatinglabel_spread_levels.length; i += 1) {
  		floatinglabel_props = assign(floatinglabel_props, floatinglabel_spread_levels[i]);
  	}

  	const floatinglabel = new FloatingLabel({ props: floatinglabel_props });

  	return {
  		c() {
  			create_component(floatinglabel.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(floatinglabel, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const floatinglabel_changes = (dirty[0] & /*$$props*/ 4194304)
  			? get_spread_update(floatinglabel_spread_levels, [
  					floatinglabel_spread_levels[0],
  					get_spread_object(prefixFilter(/*$$props*/ ctx[22], "label$"))
  				])
  			: {};

  			if (dirty[0] & /*label*/ 32768 | dirty[1] & /*$$scope*/ 8192) {
  				floatinglabel_changes.$$scope = { dirty, ctx };
  			}

  			floatinglabel.$set(floatinglabel_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(floatinglabel.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(floatinglabel.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(floatinglabel, detaching);
  		}
  	};
  }

  // (51:8) <FloatingLabel wrapped {...prefixFilter($$props, 'label$')}>
  function create_default_slot_2$1(ctx) {
  	let t;
  	let current;
  	const label_slot_template = /*$$slots*/ ctx[30].label;
  	const label_slot = create_slot(label_slot_template, ctx, /*$$scope*/ ctx[44], get_label_slot_context$1);

  	return {
  		c() {
  			t = text(/*label*/ ctx[15]);
  			if (label_slot) label_slot.c();
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);

  			if (label_slot) {
  				label_slot.m(target, anchor);
  			}

  			current = true;
  		},
  		p(ctx, dirty) {
  			if (!current || dirty[0] & /*label*/ 32768) set_data(t, /*label*/ ctx[15]);

  			if (label_slot && label_slot.p && dirty[1] & /*$$scope*/ 8192) {
  				label_slot.p(get_slot_context(label_slot_template, ctx, /*$$scope*/ ctx[44], get_label_slot_context$1), get_slot_changes(label_slot_template, /*$$scope*/ ctx[44], dirty, get_label_slot_changes$1));
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(label_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(label_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  			if (label_slot) label_slot.d(detaching);
  		}
  	};
  }

  // (53:6) {#if ripple}
  function create_if_block_4(ctx) {
  	let current;
  	const lineripple_spread_levels = [prefixFilter(/*$$props*/ ctx[22], "ripple$")];
  	let lineripple_props = {};

  	for (let i = 0; i < lineripple_spread_levels.length; i += 1) {
  		lineripple_props = assign(lineripple_props, lineripple_spread_levels[i]);
  	}

  	const lineripple = new LineRipple({ props: lineripple_props });

  	return {
  		c() {
  			create_component(lineripple.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(lineripple, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const lineripple_changes = (dirty[0] & /*$$props*/ 4194304)
  			? get_spread_update(lineripple_spread_levels, [get_spread_object(prefixFilter(/*$$props*/ ctx[22], "ripple$"))])
  			: {};

  			lineripple.$set(lineripple_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(lineripple.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(lineripple.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(lineripple, detaching);
  		}
  	};
  }

  // (57:4) {#if textarea || (variant === 'outlined' && !fullwidth)}
  function create_if_block_1(ctx) {
  	let current;

  	const notchedoutline_spread_levels = [
  		{
  			noLabel: /*noLabel*/ ctx[14] || /*label*/ ctx[15] == null
  		},
  		prefixFilter(/*$$props*/ ctx[22], "outline$")
  	];

  	let notchedoutline_props = {
  		$$slots: { default: [create_default_slot$4] },
  		$$scope: { ctx }
  	};

  	for (let i = 0; i < notchedoutline_spread_levels.length; i += 1) {
  		notchedoutline_props = assign(notchedoutline_props, notchedoutline_spread_levels[i]);
  	}

  	const notchedoutline = new NotchedOutline({ props: notchedoutline_props });

  	return {
  		c() {
  			create_component(notchedoutline.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(notchedoutline, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const notchedoutline_changes = (dirty[0] & /*noLabel, label, $$props*/ 4243456)
  			? get_spread_update(notchedoutline_spread_levels, [
  					dirty[0] & /*noLabel, label*/ 49152 && {
  						noLabel: /*noLabel*/ ctx[14] || /*label*/ ctx[15] == null
  					},
  					dirty[0] & /*$$props*/ 4194304 && get_spread_object(prefixFilter(/*$$props*/ ctx[22], "outline$"))
  				])
  			: {};

  			if (dirty[0] & /*label, noLabel*/ 49152 | dirty[1] & /*$$scope*/ 8192) {
  				notchedoutline_changes.$$scope = { dirty, ctx };
  			}

  			notchedoutline.$set(notchedoutline_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(notchedoutline.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(notchedoutline.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(notchedoutline, detaching);
  		}
  	};
  }

  // (59:8) {#if !noLabel && label != null}
  function create_if_block_2(ctx) {
  	let current;
  	const floatinglabel_spread_levels = [{ wrapped: true }, prefixFilter(/*$$props*/ ctx[22], "label$")];

  	let floatinglabel_props = {
  		$$slots: { default: [create_default_slot_1$2] },
  		$$scope: { ctx }
  	};

  	for (let i = 0; i < floatinglabel_spread_levels.length; i += 1) {
  		floatinglabel_props = assign(floatinglabel_props, floatinglabel_spread_levels[i]);
  	}

  	const floatinglabel = new FloatingLabel({ props: floatinglabel_props });

  	return {
  		c() {
  			create_component(floatinglabel.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(floatinglabel, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const floatinglabel_changes = (dirty[0] & /*$$props*/ 4194304)
  			? get_spread_update(floatinglabel_spread_levels, [
  					floatinglabel_spread_levels[0],
  					get_spread_object(prefixFilter(/*$$props*/ ctx[22], "label$"))
  				])
  			: {};

  			if (dirty[0] & /*label*/ 32768 | dirty[1] & /*$$scope*/ 8192) {
  				floatinglabel_changes.$$scope = { dirty, ctx };
  			}

  			floatinglabel.$set(floatinglabel_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(floatinglabel.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(floatinglabel.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(floatinglabel, detaching);
  		}
  	};
  }

  // (60:10) <FloatingLabel wrapped {...prefixFilter($$props, 'label$')}>
  function create_default_slot_1$2(ctx) {
  	let t;
  	let current;
  	const label_slot_template = /*$$slots*/ ctx[30].label;
  	const label_slot = create_slot(label_slot_template, ctx, /*$$scope*/ ctx[44], get_label_slot_context_1);

  	return {
  		c() {
  			t = text(/*label*/ ctx[15]);
  			if (label_slot) label_slot.c();
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);

  			if (label_slot) {
  				label_slot.m(target, anchor);
  			}

  			current = true;
  		},
  		p(ctx, dirty) {
  			if (!current || dirty[0] & /*label*/ 32768) set_data(t, /*label*/ ctx[15]);

  			if (label_slot && label_slot.p && dirty[1] & /*$$scope*/ 8192) {
  				label_slot.p(get_slot_context(label_slot_template, ctx, /*$$scope*/ ctx[44], get_label_slot_context_1), get_slot_changes(label_slot_template, /*$$scope*/ ctx[44], dirty, get_label_slot_changes_1));
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(label_slot, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(label_slot, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  			if (label_slot) label_slot.d(detaching);
  		}
  	};
  }

  // (58:6) <NotchedOutline noLabel={noLabel || label == null} {...prefixFilter($$props, 'outline$')}>
  function create_default_slot$4(ctx) {
  	let if_block_anchor;
  	let current;
  	let if_block = !/*noLabel*/ ctx[14] && /*label*/ ctx[15] != null && create_if_block_2(ctx);

  	return {
  		c() {
  			if (if_block) if_block.c();
  			if_block_anchor = empty();
  		},
  		m(target, anchor) {
  			if (if_block) if_block.m(target, anchor);
  			insert(target, if_block_anchor, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			if (!/*noLabel*/ ctx[14] && /*label*/ ctx[15] != null) {
  				if (if_block) {
  					if_block.p(ctx, dirty);
  					transition_in(if_block, 1);
  				} else {
  					if_block = create_if_block_2(ctx);
  					if_block.c();
  					transition_in(if_block, 1);
  					if_block.m(if_block_anchor.parentNode, if_block_anchor);
  				}
  			} else if (if_block) {
  				group_outros();

  				transition_out(if_block, 1, 1, () => {
  					if_block = null;
  				});

  				check_outros();
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(if_block);
  			current = true;
  		},
  		o(local) {
  			transition_out(if_block);
  			current = false;
  		},
  		d(detaching) {
  			if (if_block) if_block.d(detaching);
  			if (detaching) detach(if_block_anchor);
  		}
  	};
  }

  function create_fragment$i(ctx) {
  	let current_block_type_index;
  	let if_block;
  	let if_block_anchor;
  	let current;
  	const if_block_creators = [create_if_block$3, create_else_block_1];
  	const if_blocks = [];

  	function select_block_type(ctx, dirty) {
  		if (/*valued*/ ctx[20]) return 0;
  		return 1;
  	}

  	current_block_type_index = select_block_type(ctx);
  	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

  	return {
  		c() {
  			if_block.c();
  			if_block_anchor = empty();
  		},
  		m(target, anchor) {
  			if_blocks[current_block_type_index].m(target, anchor);
  			insert(target, if_block_anchor, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			let previous_block_index = current_block_type_index;
  			current_block_type_index = select_block_type(ctx);

  			if (current_block_type_index === previous_block_index) {
  				if_blocks[current_block_type_index].p(ctx, dirty);
  			} else {
  				group_outros();

  				transition_out(if_blocks[previous_block_index], 1, 1, () => {
  					if_blocks[previous_block_index] = null;
  				});

  				check_outros();
  				if_block = if_blocks[current_block_type_index];

  				if (!if_block) {
  					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
  					if_block.c();
  				}

  				transition_in(if_block, 1);
  				if_block.m(if_block_anchor.parentNode, if_block_anchor);
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(if_block);
  			current = true;
  		},
  		o(local) {
  			transition_out(if_block);
  			current = false;
  		},
  		d(detaching) {
  			if_blocks[current_block_type_index].d(detaching);
  			if (detaching) detach(if_block_anchor);
  		}
  	};
  }

  function instance$i($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);

  	let uninitializedValue = () => {
  		
  	};

  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { ripple = true } = $$props;
  	let { disabled = false } = $$props;
  	let { fullwidth = false } = $$props;
  	let { textarea = false } = $$props;
  	let { variant = "standard" } = $$props;
  	let { dense = false } = $$props;
  	let { withLeadingIcon = false } = $$props;
  	let { withTrailingIcon = false } = $$props;
  	let { noLabel = false } = $$props;
  	let { label = null } = $$props;
  	let { type = "text" } = $$props;
  	let { value = uninitializedValue } = $$props;
  	let { files = uninitializedValue } = $$props;
  	let { dirty = false } = $$props;
  	let { invalid = uninitializedValue } = $$props;
  	let { updateInvalid = invalid === uninitializedValue } = $$props;
  	let { useNativeValidation = updateInvalid } = $$props;
  	let element;
  	let textField;
  	let addLayoutListener = getContext("SMUI:addLayoutListener");
  	let removeLayoutListener;

  	if (addLayoutListener) {
  		removeLayoutListener = addLayoutListener(layout);
  	}

  	onMount(() => {
  		$$invalidate(26, textField = new MDCTextField(element));

  		if (!ripple) {
  			textField.ripple && textField.ripple.destroy();
  		}
  	});

  	onDestroy(() => {
  		textField && textField.destroy();

  		if (removeLayoutListener) {
  			removeLayoutListener();
  		}
  	});

  	function focus(...args) {
  		return textField.focus(...args);
  	}

  	function layout(...args) {
  		return textField.layout(...args);
  	}

  	let { $$slots = {}, $$scope } = $$props;

  	function textarea_1_value_binding(value_1) {
  		value = value_1;
  		$$invalidate(0, value);
  	}

  	function textarea_1_dirty_binding(value_2) {
  		dirty = value_2;
  		$$invalidate(2, dirty);
  	}

  	function textarea_1_invalid_binding(value_3) {
  		invalid = value_3;
  		(((((($$invalidate(3, invalid), $$invalidate(26, textField)), $$invalidate(17, updateInvalid)), $$invalidate(0, value)), $$invalidate(28, uninitializedValue)), $$invalidate(7, disabled)), $$invalidate(23, useNativeValidation));
  	}

  	function change_handler(event) {
  		bubble($$self, event);
  	}

  	function input_handler(event) {
  		bubble($$self, event);
  	}

  	function input_value_binding(value_1) {
  		value = value_1;
  		$$invalidate(0, value);
  	}

  	function input_files_binding(value_2) {
  		files = value_2;
  		$$invalidate(1, files);
  	}

  	function input_dirty_binding(value_3) {
  		dirty = value_3;
  		$$invalidate(2, dirty);
  	}

  	function input_invalid_binding(value_4) {
  		invalid = value_4;
  		(((((($$invalidate(3, invalid), $$invalidate(26, textField)), $$invalidate(17, updateInvalid)), $$invalidate(0, value)), $$invalidate(28, uninitializedValue)), $$invalidate(7, disabled)), $$invalidate(23, useNativeValidation));
  	}

  	function change_handler_1(event) {
  		bubble($$self, event);
  	}

  	function input_handler_1(event) {
  		bubble($$self, event);
  	}

  	function label_1_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(18, element = $$value);
  		});
  	}

  	function div_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(18, element = $$value);
  		});
  	}

  	$$self.$set = $$new_props => {
  		$$invalidate(22, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(4, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(5, className = $$new_props.class);
  		if ("ripple" in $$new_props) $$invalidate(6, ripple = $$new_props.ripple);
  		if ("disabled" in $$new_props) $$invalidate(7, disabled = $$new_props.disabled);
  		if ("fullwidth" in $$new_props) $$invalidate(8, fullwidth = $$new_props.fullwidth);
  		if ("textarea" in $$new_props) $$invalidate(9, textarea = $$new_props.textarea);
  		if ("variant" in $$new_props) $$invalidate(10, variant = $$new_props.variant);
  		if ("dense" in $$new_props) $$invalidate(11, dense = $$new_props.dense);
  		if ("withLeadingIcon" in $$new_props) $$invalidate(12, withLeadingIcon = $$new_props.withLeadingIcon);
  		if ("withTrailingIcon" in $$new_props) $$invalidate(13, withTrailingIcon = $$new_props.withTrailingIcon);
  		if ("noLabel" in $$new_props) $$invalidate(14, noLabel = $$new_props.noLabel);
  		if ("label" in $$new_props) $$invalidate(15, label = $$new_props.label);
  		if ("type" in $$new_props) $$invalidate(16, type = $$new_props.type);
  		if ("value" in $$new_props) $$invalidate(0, value = $$new_props.value);
  		if ("files" in $$new_props) $$invalidate(1, files = $$new_props.files);
  		if ("dirty" in $$new_props) $$invalidate(2, dirty = $$new_props.dirty);
  		if ("invalid" in $$new_props) $$invalidate(3, invalid = $$new_props.invalid);
  		if ("updateInvalid" in $$new_props) $$invalidate(17, updateInvalid = $$new_props.updateInvalid);
  		if ("useNativeValidation" in $$new_props) $$invalidate(23, useNativeValidation = $$new_props.useNativeValidation);
  		if ("$$scope" in $$new_props) $$invalidate(44, $$scope = $$new_props.$$scope);
  	};

  	let props;
  	let valued;

  	$$self.$$.update = () => {
  		 $$invalidate(19, props = exclude($$props, [
  			"use",
  			"class",
  			"ripple",
  			"disabled",
  			"fullwidth",
  			"textarea",
  			"variant",
  			"dense",
  			"withLeadingIcon",
  			"withTrailingIcon",
  			"noLabel",
  			"label",
  			"type",
  			"value",
  			"dirty",
  			"invalid",
  			"updateInvalid",
  			"useNativeValidation",
  			"input$",
  			"label$",
  			"ripple$",
  			"outline$"
  		]));

  		if ($$self.$$.dirty[0] & /*value, files*/ 3) {
  			 $$invalidate(20, valued = value !== uninitializedValue || files !== uninitializedValue);
  		}

  		if ($$self.$$.dirty[0] & /*textField, value*/ 67108865) {
  			 if (textField && value !== uninitializedValue && textField.value !== value) {
  				$$invalidate(26, textField.value = value, textField);
  			}
  		}

  		if ($$self.$$.dirty[0] & /*textField, disabled*/ 67108992) {
  			 if (textField && textField.disabled !== disabled) {
  				$$invalidate(26, textField.disabled = disabled, textField);
  			}
  		}

  		if ($$self.$$.dirty[0] & /*textField, invalid, updateInvalid*/ 67239944) {
  			 if (textField && textField.valid !== !invalid) {
  				if (updateInvalid) {
  					$$invalidate(3, invalid = !textField.valid);
  				} else {
  					$$invalidate(26, textField.valid = !invalid, textField);
  				}
  			}
  		}

  		if ($$self.$$.dirty[0] & /*textField, useNativeValidation*/ 75497472) {
  			 if (textField && textField.useNativeValidation !== useNativeValidation) {
  				$$invalidate(26, textField.useNativeValidation = useNativeValidation, textField);
  			}
  		}
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		value,
  		files,
  		dirty,
  		invalid,
  		use,
  		className,
  		ripple,
  		disabled,
  		fullwidth,
  		textarea,
  		variant,
  		dense,
  		withLeadingIcon,
  		withTrailingIcon,
  		noLabel,
  		label,
  		type,
  		updateInvalid,
  		element,
  		props,
  		valued,
  		forwardEvents,
  		$$props,
  		useNativeValidation,
  		focus,
  		layout,
  		textField,
  		removeLayoutListener,
  		uninitializedValue,
  		addLayoutListener,
  		$$slots,
  		textarea_1_value_binding,
  		textarea_1_dirty_binding,
  		textarea_1_invalid_binding,
  		change_handler,
  		input_handler,
  		input_value_binding,
  		input_files_binding,
  		input_dirty_binding,
  		input_invalid_binding,
  		change_handler_1,
  		input_handler_1,
  		label_1_binding,
  		div_binding,
  		$$scope
  	];
  }

  class Textfield extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(
  			this,
  			options,
  			instance$i,
  			create_fragment$i,
  			safe_not_equal,
  			{
  				use: 4,
  				class: 5,
  				ripple: 6,
  				disabled: 7,
  				fullwidth: 8,
  				textarea: 9,
  				variant: 10,
  				dense: 11,
  				withLeadingIcon: 12,
  				withTrailingIcon: 13,
  				noLabel: 14,
  				label: 15,
  				type: 16,
  				value: 0,
  				files: 1,
  				dirty: 2,
  				invalid: 3,
  				updateInvalid: 17,
  				useNativeValidation: 23,
  				focus: 24,
  				layout: 25
  			},
  			[-1, -1]
  		);
  	}

  	get focus() {
  		return this.$$.ctx[24];
  	}

  	get layout() {
  		return this.$$.ctx[25];
  	}
  }

  /* game.svelte generated by Svelte v3.18.1 */

  function create_default_slot_9(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("autorenew");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (42:12) <Label>
  function create_default_slot_8(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("Nouveau");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (40:8) <Button on:click={reset}>
  function create_default_slot_7(ctx) {
  	let t;
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_9] },
  				$$scope: { ctx }
  			}
  		});

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_8] },
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

  			if (dirty & /*$$scope*/ 512) {
  				icon_changes.$$scope = { dirty, ctx };
  			}

  			icon.$set(icon_changes);
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 512) {
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

  // (38:4) <Card>
  function create_default_slot_6(ctx) {
  	let t0;
  	let span;
  	let t1;
  	let t2;
  	let t3_value = (/*guesses*/ ctx[0] > 0 ? "s" : "") + "";
  	let t3;
  	let current;

  	const button = new Button_1({
  			props: {
  				$$slots: { default: [create_default_slot_7] },
  				$$scope: { ctx }
  			}
  		});

  	button.$on("click", /*reset*/ ctx[5]);

  	return {
  		c() {
  			create_component(button.$$.fragment);
  			t0 = space();
  			span = element("span");
  			t1 = text(/*guesses*/ ctx[0]);
  			t2 = text(" essai");
  			t3 = text(t3_value);
  		},
  		m(target, anchor) {
  			mount_component(button, target, anchor);
  			insert(target, t0, anchor);
  			insert(target, span, anchor);
  			append(span, t1);
  			append(span, t2);
  			append(span, t3);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const button_changes = {};

  			if (dirty & /*$$scope*/ 512) {
  				button_changes.$$scope = { dirty, ctx };
  			}

  			button.$set(button_changes);
  			if (!current || dirty & /*guesses*/ 1) set_data(t1, /*guesses*/ ctx[0]);
  			if ((!current || dirty & /*guesses*/ 1) && t3_value !== (t3_value = (/*guesses*/ ctx[0] > 0 ? "s" : "") + "")) set_data(t3, t3_value);
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
  			if (detaching) detach(t0);
  			if (detaching) detach(span);
  		}
  	};
  }

  // (58:16) {#if isUpper}
  function create_if_block_2$1(ctx) {
  	let span;

  	return {
  		c() {
  			span = element("span");
  			span.textContent = "C'est plus";
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);
  		},
  		i: noop,
  		o: noop,
  		d(detaching) {
  			if (detaching) detach(span);
  		}
  	};
  }

  // (55:12) {#if isLower}
  function create_if_block_1$1(ctx) {
  	let span;

  	return {
  		c() {
  			span = element("span");
  			span.textContent = "C'est moins";
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);
  		},
  		i: noop,
  		o: noop,
  		d(detaching) {
  			if (detaching) detach(span);
  		}
  	};
  }

  // (51:8) {#if isFound}
  function create_if_block$4(ctx) {
  	let t;
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_5$1] },
  				$$scope: { ctx }
  			}
  		});

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_4$1] },
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

  // (52:8) <Icon class="material-icons">
  function create_default_slot_5$1(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("done");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (53:8) <Label>
  function create_default_slot_4$1(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("Trouvé");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (50:4) <Card>
  function create_default_slot_3$1(ctx) {
  	let current_block_type_index;
  	let if_block;
  	let if_block_anchor;
  	let current;
  	const if_block_creators = [create_if_block$4, create_if_block_1$1, create_if_block_2$1];
  	const if_blocks = [];

  	function select_block_type(ctx, dirty) {
  		if (/*isFound*/ ctx[1]) return 0;
  		if (/*isLower*/ ctx[2]) return 1;
  		if (/*isUpper*/ ctx[3]) return 2;
  		return -1;
  	}

  	if (~(current_block_type_index = select_block_type(ctx))) {
  		if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
  	}

  	return {
  		c() {
  			if (if_block) if_block.c();
  			if_block_anchor = empty();
  		},
  		m(target, anchor) {
  			if (~current_block_type_index) {
  				if_blocks[current_block_type_index].m(target, anchor);
  			}

  			insert(target, if_block_anchor, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			let previous_block_index = current_block_type_index;
  			current_block_type_index = select_block_type(ctx);

  			if (current_block_type_index !== previous_block_index) {
  				if (if_block) {
  					group_outros();

  					transition_out(if_blocks[previous_block_index], 1, 1, () => {
  						if_blocks[previous_block_index] = null;
  					});

  					check_outros();
  				}

  				if (~current_block_type_index) {
  					if_block = if_blocks[current_block_type_index];

  					if (!if_block) {
  						if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
  						if_block.c();
  					}

  					transition_in(if_block, 1);
  					if_block.m(if_block_anchor.parentNode, if_block_anchor);
  				} else {
  					if_block = null;
  				}
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(if_block);
  			current = true;
  		},
  		o(local) {
  			transition_out(if_block);
  			current = false;
  		},
  		d(detaching) {
  			if (~current_block_type_index) {
  				if_blocks[current_block_type_index].d(detaching);
  			}

  			if (detaching) detach(if_block_anchor);
  		}
  	};
  }

  // (70:12) <Label>
  function create_default_slot_2$2(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("Essayer");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (69:8) <Button on:click={guess}>
  function create_default_slot_1$3(ctx) {
  	let current;

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_2$2] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 512) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (67:4) <Card>
  function create_default_slot$5(ctx) {
  	let updating_value;
  	let t;
  	let current;

  	function textfield_value_binding(value) {
  		/*textfield_value_binding*/ ctx[8].call(null, value);
  	}

  	let textfield_props = { label: "essai", type: "number" };

  	if (/*currentGuess*/ ctx[4] !== void 0) {
  		textfield_props.value = /*currentGuess*/ ctx[4];
  	}

  	const textfield = new Textfield({ props: textfield_props });
  	binding_callbacks.push(() => bind(textfield, "value", textfield_value_binding));

  	const button = new Button_1({
  			props: {
  				$$slots: { default: [create_default_slot_1$3] },
  				$$scope: { ctx }
  			}
  		});

  	button.$on("click", /*guess*/ ctx[6]);

  	return {
  		c() {
  			create_component(textfield.$$.fragment);
  			t = space();
  			create_component(button.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(textfield, target, anchor);
  			insert(target, t, anchor);
  			mount_component(button, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const textfield_changes = {};

  			if (!updating_value && dirty & /*currentGuess*/ 16) {
  				updating_value = true;
  				textfield_changes.value = /*currentGuess*/ ctx[4];
  				add_flush_callback(() => updating_value = false);
  			}

  			textfield.$set(textfield_changes);
  			const button_changes = {};

  			if (dirty & /*$$scope*/ 512) {
  				button_changes.$$scope = { dirty, ctx };
  			}

  			button.$set(button_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(textfield.$$.fragment, local);
  			transition_in(button.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(textfield.$$.fragment, local);
  			transition_out(button.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(textfield, detaching);
  			if (detaching) detach(t);
  			destroy_component(button, detaching);
  		}
  	};
  }

  function create_fragment$j(ctx) {
  	let div0;
  	let t0;
  	let div1;
  	let t1;
  	let div2;
  	let current;

  	const card0 = new Card({
  			props: {
  				$$slots: { default: [create_default_slot_6] },
  				$$scope: { ctx }
  			}
  		});

  	const card1 = new Card({
  			props: {
  				$$slots: { default: [create_default_slot_3$1] },
  				$$scope: { ctx }
  			}
  		});

  	const card2 = new Card({
  			props: {
  				$$slots: { default: [create_default_slot$5] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			div0 = element("div");
  			create_component(card0.$$.fragment);
  			t0 = space();
  			div1 = element("div");
  			create_component(card1.$$.fragment);
  			t1 = space();
  			div2 = element("div");
  			create_component(card2.$$.fragment);
  			attr(div0, "class", "container");
  			attr(div1, "class", "container");
  			attr(div2, "class", "container");
  		},
  		m(target, anchor) {
  			insert(target, div0, anchor);
  			mount_component(card0, div0, null);
  			insert(target, t0, anchor);
  			insert(target, div1, anchor);
  			mount_component(card1, div1, null);
  			insert(target, t1, anchor);
  			insert(target, div2, anchor);
  			mount_component(card2, div2, null);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const card0_changes = {};

  			if (dirty & /*$$scope, guesses*/ 513) {
  				card0_changes.$$scope = { dirty, ctx };
  			}

  			card0.$set(card0_changes);
  			const card1_changes = {};

  			if (dirty & /*$$scope, isFound, isLower, isUpper*/ 526) {
  				card1_changes.$$scope = { dirty, ctx };
  			}

  			card1.$set(card1_changes);
  			const card2_changes = {};

  			if (dirty & /*$$scope, currentGuess*/ 528) {
  				card2_changes.$$scope = { dirty, ctx };
  			}

  			card2.$set(card2_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(card0.$$.fragment, local);
  			transition_in(card1.$$.fragment, local);
  			transition_in(card2.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(card0.$$.fragment, local);
  			transition_out(card1.$$.fragment, local);
  			transition_out(card2.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div0);
  			destroy_component(card0);
  			if (detaching) detach(t0);
  			if (detaching) detach(div1);
  			destroy_component(card1);
  			if (detaching) detach(t1);
  			if (detaching) detach(div2);
  			destroy_component(card2);
  		}
  	};
  }

  function instance$j($$self, $$props, $$invalidate) {
  	let toBeGuessed = 0;
  	let guesses = 0;
  	let isFound = false;
  	let isLower = false;
  	let isUpper = false;
  	let currentGuess = "votre essai";

  	onMount(async () => {
  		reset();
  	});

  	function reset() {
  		toBeGuessed = Math.floor(Math.random() * Math.floor(100));
  		$$invalidate(0, guesses = 0);
  	}

  	function guess() {
  		$$invalidate(0, guesses++, guesses);
  		console.log(`${currentGuess} ?? ${toBeGuessed}`);
  		$$invalidate(1, isFound = toBeGuessed == currentGuess);
  		$$invalidate(2, isLower = toBeGuessed < currentGuess);
  		$$invalidate(3, isUpper = toBeGuessed > currentGuess);
  	}

  	function textfield_value_binding(value) {
  		currentGuess = value;
  		$$invalidate(4, currentGuess);
  	}

  	return [
  		guesses,
  		isFound,
  		isLower,
  		isUpper,
  		currentGuess,
  		reset,
  		guess,
  		toBeGuessed,
  		textfield_value_binding
  	];
  }

  class Game extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$j, create_fragment$j, safe_not_equal, {});
  	}
  }

  /* game2.svelte generated by Svelte v3.18.1 */

  function create_default_slot_32(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("autorenew");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (63:8) <Fab on:click={reset} class="row">
  function create_default_slot_31(ctx) {
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_32] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(icon.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(icon, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const icon_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				icon_changes.$$scope = { dirty, ctx };
  			}

  			icon.$set(icon_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(icon.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(icon.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(icon, detaching);
  		}
  	};
  }

  // (61:4) <Card>
  function create_default_slot_30(ctx) {
  	let t0;
  	let span;
  	let t1;
  	let t2;
  	let t3_value = (/*guesses*/ ctx[0] > 0 ? "s" : "") + "";
  	let t3;
  	let current;

  	const fab = new Fab({
  			props: {
  				class: "row",
  				$$slots: { default: [create_default_slot_31] },
  				$$scope: { ctx }
  			}
  		});

  	fab.$on("click", /*reset*/ ctx[6]);

  	return {
  		c() {
  			create_component(fab.$$.fragment);
  			t0 = space();
  			span = element("span");
  			t1 = text(/*guesses*/ ctx[0]);
  			t2 = text(" essai");
  			t3 = text(t3_value);
  		},
  		m(target, anchor) {
  			mount_component(fab, target, anchor);
  			insert(target, t0, anchor);
  			insert(target, span, anchor);
  			append(span, t1);
  			append(span, t2);
  			append(span, t3);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const fab_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				fab_changes.$$scope = { dirty, ctx };
  			}

  			fab.$set(fab_changes);
  			if (!current || dirty & /*guesses*/ 1) set_data(t1, /*guesses*/ ctx[0]);
  			if ((!current || dirty & /*guesses*/ 1) && t3_value !== (t3_value = (/*guesses*/ ctx[0] > 0 ? "s" : "") + "")) set_data(t3, t3_value);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(fab.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(fab.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(fab, detaching);
  			if (detaching) detach(t0);
  			if (detaching) detach(span);
  		}
  	};
  }

  // (92:12) {:else}
  function create_else_block$3(ctx) {
  	let div0;
  	let t0;
  	let div1;
  	let t1;
  	let div2;
  	let current;
  	let if_block0 = /*isLower*/ ctx[2] && create_if_block_2$2(ctx);

  	const button = new Button_1({
  			props: {
  				variant: "raised",
  				ripple: "true",
  				color: "secondary",
  				class: "row",
  				$$slots: { default: [create_default_slot_27] },
  				$$scope: { ctx }
  			}
  		});

  	button.$on("click", /*guess*/ ctx[7]);
  	let if_block1 = /*isUpper*/ ctx[3] && create_if_block_1$2(ctx);

  	return {
  		c() {
  			div0 = element("div");
  			if (if_block0) if_block0.c();
  			t0 = space();
  			div1 = element("div");
  			create_component(button.$$.fragment);
  			t1 = space();
  			div2 = element("div");
  			if (if_block1) if_block1.c();
  			set_style(div0, "width", "33%");
  			set_style(div1, "text-align", "center");
  			set_style(div1, "width", "33%");
  			set_style(div2, "width", "33%");
  		},
  		m(target, anchor) {
  			insert(target, div0, anchor);
  			if (if_block0) if_block0.m(div0, null);
  			insert(target, t0, anchor);
  			insert(target, div1, anchor);
  			mount_component(button, div1, null);
  			insert(target, t1, anchor);
  			insert(target, div2, anchor);
  			if (if_block1) if_block1.m(div2, null);
  			current = true;
  		},
  		p(ctx, dirty) {
  			if (/*isLower*/ ctx[2]) {
  				if (!if_block0) {
  					if_block0 = create_if_block_2$2(ctx);
  					if_block0.c();
  					transition_in(if_block0, 1);
  					if_block0.m(div0, null);
  				} else {
  					transition_in(if_block0, 1);
  				}
  			} else if (if_block0) {
  				group_outros();

  				transition_out(if_block0, 1, 1, () => {
  					if_block0 = null;
  				});

  				check_outros();
  			}

  			const button_changes = {};

  			if (dirty & /*$$scope, typed*/ 2097168) {
  				button_changes.$$scope = { dirty, ctx };
  			}

  			button.$set(button_changes);

  			if (/*isUpper*/ ctx[3]) {
  				if (!if_block1) {
  					if_block1 = create_if_block_1$2(ctx);
  					if_block1.c();
  					transition_in(if_block1, 1);
  					if_block1.m(div2, null);
  				} else {
  					transition_in(if_block1, 1);
  				}
  			} else if (if_block1) {
  				group_outros();

  				transition_out(if_block1, 1, 1, () => {
  					if_block1 = null;
  				});

  				check_outros();
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(if_block0);
  			transition_in(button.$$.fragment, local);
  			transition_in(if_block1);
  			current = true;
  		},
  		o(local) {
  			transition_out(if_block0);
  			transition_out(button.$$.fragment, local);
  			transition_out(if_block1);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div0);
  			if (if_block0) if_block0.d();
  			if (detaching) detach(t0);
  			if (detaching) detach(div1);
  			destroy_component(button);
  			if (detaching) detach(t1);
  			if (detaching) detach(div2);
  			if (if_block1) if_block1.d();
  		}
  	};
  }

  // (89:12) {#if isFound}
  function create_if_block$5(ctx) {
  	let t;
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_25] },
  				$$scope: { ctx }
  			}
  		});

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_24] },
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

  			if (dirty & /*$$scope*/ 2097152) {
  				icon_changes.$$scope = { dirty, ctx };
  			}

  			icon.$set(icon_changes);
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
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

  // (94:16) {#if isLower}
  function create_if_block_2$2(ctx) {
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_29] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(icon.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(icon, target, anchor);
  			current = true;
  		},
  		i(local) {
  			if (current) return;
  			transition_in(icon.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(icon.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(icon, detaching);
  		}
  	};
  }

  // (95:16) <Icon class="material-icons">
  function create_default_slot_29(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("chevron_left");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (101:16) <Label>
  function create_default_slot_28(ctx) {
  	let t;

  	return {
  		c() {
  			t = text(/*typed*/ ctx[4]);
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		p(ctx, dirty) {
  			if (dirty & /*typed*/ 16) set_data(t, /*typed*/ ctx[4]);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (100:12) <Button variant="raised" ripple="true" color="secondary" on:click={guess} class="row">
  function create_default_slot_27(ctx) {
  	let current;

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_28] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const label_changes = {};

  			if (dirty & /*$$scope, typed*/ 2097168) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (106:12) {#if isUpper}
  function create_if_block_1$2(ctx) {
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_26] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(icon.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(icon, target, anchor);
  			current = true;
  		},
  		i(local) {
  			if (current) return;
  			transition_in(icon.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(icon.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(icon, detaching);
  		}
  	};
  }

  // (107:12) <Icon class="material-icons">
  function create_default_slot_26(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("chevron_right");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (90:12) <Icon class="material-icons">
  function create_default_slot_25(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("done");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (91:12) <Label>
  function create_default_slot_24(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("Trouvé");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (73:4) <Card>
  function create_default_slot_23(ctx) {
  	let div0;
  	let t;
  	let div1;
  	let current_block_type_index;
  	let if_block;
  	let current;
  	const if_block_creators = [create_if_block$5, create_else_block$3];
  	const if_blocks = [];

  	function select_block_type(ctx, dirty) {
  		if (/*isFound*/ ctx[1]) return 0;
  		return 1;
  	}

  	current_block_type_index = select_block_type(ctx);
  	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

  	return {
  		c() {
  			div0 = element("div");
  			t = space();
  			div1 = element("div");
  			if_block.c();
  			set_style(div0, "margin", "0 auto");
  			set_style(div0, "width", "100%");
  			set_style(div0, "flex-wrap", "wrap");
  			set_style(div0, "padding", "10px");
  			set_style(div0, "display", "flex");
  			set_style(div0, "flex-direction", "row");
  			set_style(div1, "margin", "0 auto");
  			set_style(div1, "width", "100%");
  			set_style(div1, "flex-wrap", "wrap");
  			set_style(div1, "padding", "10px");
  			set_style(div1, "display", "flex");
  			set_style(div1, "flex-direction", "row");
  		},
  		m(target, anchor) {
  			insert(target, div0, anchor);
  			insert(target, t, anchor);
  			insert(target, div1, anchor);
  			if_blocks[current_block_type_index].m(div1, null);
  			current = true;
  		},
  		p(ctx, dirty) {
  			let previous_block_index = current_block_type_index;
  			current_block_type_index = select_block_type(ctx);

  			if (current_block_type_index === previous_block_index) {
  				if_blocks[current_block_type_index].p(ctx, dirty);
  			} else {
  				group_outros();

  				transition_out(if_blocks[previous_block_index], 1, 1, () => {
  					if_blocks[previous_block_index] = null;
  				});

  				check_outros();
  				if_block = if_blocks[current_block_type_index];

  				if (!if_block) {
  					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
  					if_block.c();
  				}

  				transition_in(if_block, 1);
  				if_block.m(div1, null);
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(if_block);
  			current = true;
  		},
  		o(local) {
  			transition_out(if_block);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div0);
  			if (detaching) detach(t);
  			if (detaching) detach(div1);
  			if_blocks[current_block_type_index].d();
  		}
  	};
  }

  // (125:20) <Label>
  function create_default_slot_22(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("7");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (124:20) <Button variant="raised" ripple="true" color="secondary" on:click={() => {type(7)} } class="row">
  function create_default_slot_21(ctx) {
  	let current;

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_22] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (130:20) <Label>
  function create_default_slot_20(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("8");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (129:20) <Button variant="raised" ripple="true" color="secondary" on:click={() => {type(8)} } class="row">
  function create_default_slot_19(ctx) {
  	let current;

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_20] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (135:20) <Label>
  function create_default_slot_18(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("9");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (134:20) <Button variant="raised" ripple="true" color="secondary" on:click={() => {type(9)} } class="row">
  function create_default_slot_17(ctx) {
  	let current;

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_18] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (143:20) <Label>
  function create_default_slot_16(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("4");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (142:20) <Button variant="raised" ripple="true" color="secondary" on:click={() => {type(4)} } class="row">
  function create_default_slot_15(ctx) {
  	let current;

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_16] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (148:20) <Label>
  function create_default_slot_14(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("5");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (147:20) <Button variant="raised" ripple="true" color="secondary" on:click={() => {type(5)} } class="row">
  function create_default_slot_13(ctx) {
  	let current;

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_14] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (153:20) <Label>
  function create_default_slot_12(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("6");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (152:20) <Button variant="raised" ripple="true" color="secondary" on:click={() => {type(6)} } class="row">
  function create_default_slot_11(ctx) {
  	let current;

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_12] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (161:24) <Label>
  function create_default_slot_10(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("1");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (160:20) <Button variant="raised" ripple="true" color="secondary" on:click={() => {type(1)} } class="row">
  function create_default_slot_9$1(ctx) {
  	let current;

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_10] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (167:20) <Label>
  function create_default_slot_8$1(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("2");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (166:20) <Button variant="raised" ripple="true" color="secondary" on:click={() => {type(2)} } class="row">
  function create_default_slot_7$1(ctx) {
  	let current;

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_8$1] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (172:20) <Label>
  function create_default_slot_6$1(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("3");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (171:20) <Button variant="raised" ripple="true" color="secondary" on:click={() => {type(3)} } class="row">
  function create_default_slot_5$2(ctx) {
  	let current;

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_6$1] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (179:20) <Label>
  function create_default_slot_4$2(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("0");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (178:20) <Button variant="raised" ripple="true" color="secondary" on:click={() => {type(0)} } class="row">
  function create_default_slot_3$2(ctx) {
  	let current;

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_4$2] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (184:24) <Label>
  function create_default_slot_2$3(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("C");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (183:20) <Button variant="raised" ripple="true" color="secondary" class="row" on:click={() => {typed=0} }>
  function create_default_slot_1$4(ctx) {
  	let current;

  	const label = new Label({
  			props: {
  				$$slots: { default: [create_default_slot_2$3] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(label.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(label, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const label_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				label_changes.$$scope = { dirty, ctx };
  			}

  			label.$set(label_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(label.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(label.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(label, detaching);
  		}
  	};
  }

  // (117:4) <Card>
  function create_default_slot$6(ctx) {
  	let div15;
  	let div3;
  	let div0;
  	let t0;
  	let div1;
  	let t1;
  	let div2;
  	let t2;
  	let div7;
  	let div4;
  	let t3;
  	let div5;
  	let t4;
  	let div6;
  	let t5;
  	let div11;
  	let div8;
  	let t6;
  	let div9;
  	let t7;
  	let div10;
  	let t8;
  	let div14;
  	let div12;
  	let t9;
  	let div13;
  	let current;

  	const button0 = new Button_1({
  			props: {
  				variant: "raised",
  				ripple: "true",
  				color: "secondary",
  				class: "row",
  				$$slots: { default: [create_default_slot_21] },
  				$$scope: { ctx }
  			}
  		});

  	button0.$on("click", /*click_handler*/ ctx[10]);

  	const button1 = new Button_1({
  			props: {
  				variant: "raised",
  				ripple: "true",
  				color: "secondary",
  				class: "row",
  				$$slots: { default: [create_default_slot_19] },
  				$$scope: { ctx }
  			}
  		});

  	button1.$on("click", /*click_handler_1*/ ctx[11]);

  	const button2 = new Button_1({
  			props: {
  				variant: "raised",
  				ripple: "true",
  				color: "secondary",
  				class: "row",
  				$$slots: { default: [create_default_slot_17] },
  				$$scope: { ctx }
  			}
  		});

  	button2.$on("click", /*click_handler_2*/ ctx[12]);

  	const button3 = new Button_1({
  			props: {
  				variant: "raised",
  				ripple: "true",
  				color: "secondary",
  				class: "row",
  				$$slots: { default: [create_default_slot_15] },
  				$$scope: { ctx }
  			}
  		});

  	button3.$on("click", /*click_handler_3*/ ctx[13]);

  	const button4 = new Button_1({
  			props: {
  				variant: "raised",
  				ripple: "true",
  				color: "secondary",
  				class: "row",
  				$$slots: { default: [create_default_slot_13] },
  				$$scope: { ctx }
  			}
  		});

  	button4.$on("click", /*click_handler_4*/ ctx[14]);

  	const button5 = new Button_1({
  			props: {
  				variant: "raised",
  				ripple: "true",
  				color: "secondary",
  				class: "row",
  				$$slots: { default: [create_default_slot_11] },
  				$$scope: { ctx }
  			}
  		});

  	button5.$on("click", /*click_handler_5*/ ctx[15]);

  	const button6 = new Button_1({
  			props: {
  				variant: "raised",
  				ripple: "true",
  				color: "secondary",
  				class: "row",
  				$$slots: { default: [create_default_slot_9$1] },
  				$$scope: { ctx }
  			}
  		});

  	button6.$on("click", /*click_handler_6*/ ctx[16]);

  	const button7 = new Button_1({
  			props: {
  				variant: "raised",
  				ripple: "true",
  				color: "secondary",
  				class: "row",
  				$$slots: { default: [create_default_slot_7$1] },
  				$$scope: { ctx }
  			}
  		});

  	button7.$on("click", /*click_handler_7*/ ctx[17]);

  	const button8 = new Button_1({
  			props: {
  				variant: "raised",
  				ripple: "true",
  				color: "secondary",
  				class: "row",
  				$$slots: { default: [create_default_slot_5$2] },
  				$$scope: { ctx }
  			}
  		});

  	button8.$on("click", /*click_handler_8*/ ctx[18]);

  	const button9 = new Button_1({
  			props: {
  				variant: "raised",
  				ripple: "true",
  				color: "secondary",
  				class: "row",
  				$$slots: { default: [create_default_slot_3$2] },
  				$$scope: { ctx }
  			}
  		});

  	button9.$on("click", /*click_handler_9*/ ctx[19]);

  	const button10 = new Button_1({
  			props: {
  				variant: "raised",
  				ripple: "true",
  				color: "secondary",
  				class: "row",
  				$$slots: { default: [create_default_slot_1$4] },
  				$$scope: { ctx }
  			}
  		});

  	button10.$on("click", /*click_handler_10*/ ctx[20]);

  	return {
  		c() {
  			div15 = element("div");
  			div3 = element("div");
  			div0 = element("div");
  			create_component(button0.$$.fragment);
  			t0 = space();
  			div1 = element("div");
  			create_component(button1.$$.fragment);
  			t1 = space();
  			div2 = element("div");
  			create_component(button2.$$.fragment);
  			t2 = space();
  			div7 = element("div");
  			div4 = element("div");
  			create_component(button3.$$.fragment);
  			t3 = space();
  			div5 = element("div");
  			create_component(button4.$$.fragment);
  			t4 = space();
  			div6 = element("div");
  			create_component(button5.$$.fragment);
  			t5 = space();
  			div11 = element("div");
  			div8 = element("div");
  			create_component(button6.$$.fragment);
  			t6 = space();
  			div9 = element("div");
  			create_component(button7.$$.fragment);
  			t7 = space();
  			div10 = element("div");
  			create_component(button8.$$.fragment);
  			t8 = space();
  			div14 = element("div");
  			div12 = element("div");
  			create_component(button9.$$.fragment);
  			t9 = space();
  			div13 = element("div");
  			create_component(button10.$$.fragment);
  			attr(div0, "class", "button svelte-16lhtdr");
  			attr(div1, "class", "button svelte-16lhtdr");
  			attr(div2, "class", "button svelte-16lhtdr");
  			set_style(div3, "margin", "0 auto");
  			set_style(div3, "width", "100%");
  			set_style(div3, "flex-wrap", "wrap");
  			set_style(div3, "padding", "10px");
  			set_style(div3, "display", "flex");
  			set_style(div3, "flex-direction", "row");
  			attr(div4, "class", "button svelte-16lhtdr");
  			attr(div5, "class", "button svelte-16lhtdr");
  			attr(div6, "class", "button svelte-16lhtdr");
  			set_style(div7, "margin", "0 auto");
  			set_style(div7, "width", "100%");
  			set_style(div7, "flex-wrap", "wrap");
  			set_style(div7, "padding", "10px");
  			set_style(div7, "display", "flex");
  			set_style(div7, "flex-direction", "row");
  			attr(div8, "class", "button svelte-16lhtdr");
  			attr(div9, "class", "button svelte-16lhtdr");
  			attr(div10, "class", "button svelte-16lhtdr");
  			set_style(div11, "margin", "0 auto");
  			set_style(div11, "width", "100%");
  			set_style(div11, "flex-wrap", "wrap");
  			set_style(div11, "padding", "10px");
  			set_style(div11, "display", "flex");
  			set_style(div11, "flex-direction", "row");
  			attr(div12, "class", "button svelte-16lhtdr");
  			attr(div13, "class", "button svelte-16lhtdr");
  			set_style(div14, "margin", "0 auto");
  			set_style(div14, "width", "100%");
  			set_style(div14, "flex-wrap", "wrap");
  			set_style(div14, "padding", "10px");
  			set_style(div14, "display", "flex");
  			set_style(div14, "flex-direction", "row");
  			set_style(div15, "margin", "0 auto");
  			set_style(div15, "width", "100%");
  			set_style(div15, "flex-wrap", "wrap");
  			set_style(div15, "padding", "10px");
  			set_style(div15, "display", "flex");
  			set_style(div15, "flex-direction", "column");
  		},
  		m(target, anchor) {
  			insert(target, div15, anchor);
  			append(div15, div3);
  			append(div3, div0);
  			mount_component(button0, div0, null);
  			append(div3, t0);
  			append(div3, div1);
  			mount_component(button1, div1, null);
  			append(div3, t1);
  			append(div3, div2);
  			mount_component(button2, div2, null);
  			append(div15, t2);
  			append(div15, div7);
  			append(div7, div4);
  			mount_component(button3, div4, null);
  			append(div7, t3);
  			append(div7, div5);
  			mount_component(button4, div5, null);
  			append(div7, t4);
  			append(div7, div6);
  			mount_component(button5, div6, null);
  			append(div15, t5);
  			append(div15, div11);
  			append(div11, div8);
  			mount_component(button6, div8, null);
  			append(div11, t6);
  			append(div11, div9);
  			mount_component(button7, div9, null);
  			append(div11, t7);
  			append(div11, div10);
  			mount_component(button8, div10, null);
  			append(div15, t8);
  			append(div15, div14);
  			append(div14, div12);
  			mount_component(button9, div12, null);
  			append(div14, t9);
  			append(div14, div13);
  			mount_component(button10, div13, null);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const button0_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				button0_changes.$$scope = { dirty, ctx };
  			}

  			button0.$set(button0_changes);
  			const button1_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				button1_changes.$$scope = { dirty, ctx };
  			}

  			button1.$set(button1_changes);
  			const button2_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				button2_changes.$$scope = { dirty, ctx };
  			}

  			button2.$set(button2_changes);
  			const button3_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				button3_changes.$$scope = { dirty, ctx };
  			}

  			button3.$set(button3_changes);
  			const button4_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				button4_changes.$$scope = { dirty, ctx };
  			}

  			button4.$set(button4_changes);
  			const button5_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				button5_changes.$$scope = { dirty, ctx };
  			}

  			button5.$set(button5_changes);
  			const button6_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				button6_changes.$$scope = { dirty, ctx };
  			}

  			button6.$set(button6_changes);
  			const button7_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				button7_changes.$$scope = { dirty, ctx };
  			}

  			button7.$set(button7_changes);
  			const button8_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				button8_changes.$$scope = { dirty, ctx };
  			}

  			button8.$set(button8_changes);
  			const button9_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				button9_changes.$$scope = { dirty, ctx };
  			}

  			button9.$set(button9_changes);
  			const button10_changes = {};

  			if (dirty & /*$$scope*/ 2097152) {
  				button10_changes.$$scope = { dirty, ctx };
  			}

  			button10.$set(button10_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(button0.$$.fragment, local);
  			transition_in(button1.$$.fragment, local);
  			transition_in(button2.$$.fragment, local);
  			transition_in(button3.$$.fragment, local);
  			transition_in(button4.$$.fragment, local);
  			transition_in(button5.$$.fragment, local);
  			transition_in(button6.$$.fragment, local);
  			transition_in(button7.$$.fragment, local);
  			transition_in(button8.$$.fragment, local);
  			transition_in(button9.$$.fragment, local);
  			transition_in(button10.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(button0.$$.fragment, local);
  			transition_out(button1.$$.fragment, local);
  			transition_out(button2.$$.fragment, local);
  			transition_out(button3.$$.fragment, local);
  			transition_out(button4.$$.fragment, local);
  			transition_out(button5.$$.fragment, local);
  			transition_out(button6.$$.fragment, local);
  			transition_out(button7.$$.fragment, local);
  			transition_out(button8.$$.fragment, local);
  			transition_out(button9.$$.fragment, local);
  			transition_out(button10.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div15);
  			destroy_component(button0);
  			destroy_component(button1);
  			destroy_component(button2);
  			destroy_component(button3);
  			destroy_component(button4);
  			destroy_component(button5);
  			destroy_component(button6);
  			destroy_component(button7);
  			destroy_component(button8);
  			destroy_component(button9);
  			destroy_component(button10);
  		}
  	};
  }

  function create_fragment$k(ctx) {
  	let div0;
  	let t0;
  	let div1;
  	let t1;
  	let div2;
  	let current;

  	const card0 = new Card({
  			props: {
  				$$slots: { default: [create_default_slot_30] },
  				$$scope: { ctx }
  			}
  		});

  	const card1 = new Card({
  			props: {
  				$$slots: { default: [create_default_slot_23] },
  				$$scope: { ctx }
  			}
  		});

  	const card2 = new Card({
  			props: {
  				$$slots: { default: [create_default_slot$6] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			div0 = element("div");
  			create_component(card0.$$.fragment);
  			t0 = space();
  			div1 = element("div");
  			create_component(card1.$$.fragment);
  			t1 = space();
  			div2 = element("div");
  			create_component(card2.$$.fragment);
  			attr(div0, "class", "container");
  			attr(div1, "class", "container");
  			attr(div2, "class", "container");
  		},
  		m(target, anchor) {
  			insert(target, div0, anchor);
  			mount_component(card0, div0, null);
  			insert(target, t0, anchor);
  			insert(target, div1, anchor);
  			mount_component(card1, div1, null);
  			insert(target, t1, anchor);
  			insert(target, div2, anchor);
  			mount_component(card2, div2, null);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const card0_changes = {};

  			if (dirty & /*$$scope, guesses*/ 2097153) {
  				card0_changes.$$scope = { dirty, ctx };
  			}

  			card0.$set(card0_changes);
  			const card1_changes = {};

  			if (dirty & /*$$scope, isFound, isUpper, typed, isLower*/ 2097182) {
  				card1_changes.$$scope = { dirty, ctx };
  			}

  			card1.$set(card1_changes);
  			const card2_changes = {};

  			if (dirty & /*$$scope, typed*/ 2097168) {
  				card2_changes.$$scope = { dirty, ctx };
  			}

  			card2.$set(card2_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(card0.$$.fragment, local);
  			transition_in(card1.$$.fragment, local);
  			transition_in(card2.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(card0.$$.fragment, local);
  			transition_out(card1.$$.fragment, local);
  			transition_out(card2.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div0);
  			destroy_component(card0);
  			if (detaching) detach(t0);
  			if (detaching) detach(div1);
  			destroy_component(card1);
  			if (detaching) detach(t1);
  			if (detaching) detach(div2);
  			destroy_component(card2);
  		}
  	};
  }

  function instance$k($$self, $$props, $$invalidate) {
  	let toBeGuessed = 0;
  	let guesses = 0;
  	let isFound = false;
  	let isLower = false;
  	let isUpper = false;
  	let typed = 0;
  	let tried = false;

  	onMount(async () => {
  		reset();
  	});

  	function type(x) {
  		if (tried) {
  			$$invalidate(4, typed = 0);
  		}

  		tried = false;
  		$$invalidate(4, typed = typed * 10 + x);
  	}

  	function reset() {
  		toBeGuessed = Math.floor(Math.random() * Math.floor(100));
  		$$invalidate(0, guesses = 0);
  		$$invalidate(4, typed = 0);
  	}

  	function guess() {
  		$$invalidate(0, guesses++, guesses);
  		console.log(`${typed} ?? ${toBeGuessed}`);
  		$$invalidate(1, isFound = toBeGuessed == typed);
  		$$invalidate(2, isLower = toBeGuessed < typed);
  		$$invalidate(3, isUpper = toBeGuessed > typed);
  		tried = true;
  	}

  	const click_handler = () => {
  		type(7);
  	};

  	const click_handler_1 = () => {
  		type(8);
  	};

  	const click_handler_2 = () => {
  		type(9);
  	};

  	const click_handler_3 = () => {
  		type(4);
  	};

  	const click_handler_4 = () => {
  		type(5);
  	};

  	const click_handler_5 = () => {
  		type(6);
  	};

  	const click_handler_6 = () => {
  		type(1);
  	};

  	const click_handler_7 = () => {
  		type(2);
  	};

  	const click_handler_8 = () => {
  		type(3);
  	};

  	const click_handler_9 = () => {
  		type(0);
  	};

  	const click_handler_10 = () => {
  		$$invalidate(4, typed = 0);
  	};

  	return [
  		guesses,
  		isFound,
  		isLower,
  		isUpper,
  		typed,
  		type,
  		reset,
  		guess,
  		toBeGuessed,
  		tried,
  		click_handler,
  		click_handler_1,
  		click_handler_2,
  		click_handler_3,
  		click_handler_4,
  		click_handler_5,
  		click_handler_6,
  		click_handler_7,
  		click_handler_8,
  		click_handler_9,
  		click_handler_10
  	];
  }

  class Game2 extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$k, create_fragment$k, safe_not_equal, {});
  	}
  }

  /* NotFound.svelte generated by Svelte v3.18.1 */

  function create_default_slot$7(ctx) {
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

  function create_fragment$l(ctx) {
  	let div;
  	let current;

  	const card = new Card({
  			props: {
  				$$slots: { default: [create_default_slot$7] },
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
  		init(this, options, null, create_fragment$l, safe_not_equal, {});
  	}
  }

  /* empty.svelte generated by Svelte v3.18.1 */

  function create_default_slot_1$5(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("message");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (29:8) <Fab on:click={notify} class="row">
  function create_default_slot$8(ctx) {
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_1$5] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(icon.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(icon, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const icon_changes = {};

  			if (dirty & /*$$scope*/ 2) {
  				icon_changes.$$scope = { dirty, ctx };
  			}

  			icon.$set(icon_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(icon.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(icon.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(icon, detaching);
  		}
  	};
  }

  function create_fragment$m(ctx) {
  	let div1;
  	let div0;
  	let current;

  	const fab = new Fab({
  			props: {
  				class: "row",
  				$$slots: { default: [create_default_slot$8] },
  				$$scope: { ctx }
  			}
  		});

  	fab.$on("click", /*notify*/ ctx[0]);

  	return {
  		c() {
  			div1 = element("div");
  			div0 = element("div");
  			create_component(fab.$$.fragment);
  			set_style(div0, "margin", "0 auto");
  			set_style(div0, "width", "50%");
  			set_style(div0, "flex-wrap", "wrap");
  			set_style(div0, "padding", "10px");
  			set_style(div0, "display", "flex");
  			set_style(div0, "flex-direction", "column");
  			attr(div1, "class", "container");
  		},
  		m(target, anchor) {
  			insert(target, div1, anchor);
  			append(div1, div0);
  			mount_component(fab, div0, null);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const fab_changes = {};

  			if (dirty & /*$$scope*/ 2) {
  				fab_changes.$$scope = { dirty, ctx };
  			}

  			fab.$set(fab_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(fab.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(fab.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			if (detaching) detach(div1);
  			destroy_component(fab);
  		}
  	};
  }

  function instance$l($$self) {
  	let notify = function () {

  		var notificationOptions = {
  			body: "une notification qu\"elle est belle !.",
  			icon: "./images/icons/icon-192x192.png",
  			badge: "",
  			tag: "",
  			data: {
  				url: "https://developers.google.com/web/fundamentals/getting-started/push-notifications/"
  			},
  			text: "une notification"
  		};

  		navigator.serviceWorker.getRegistration().then(reg => reg.showNotification("une notification", notificationOptions));
  	};

  	return [notify];
  }

  class Empty extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$l, create_fragment$m, safe_not_equal, {});
  	}
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

  function create_fragment$n(ctx) {
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

  function push(location) {
  	if (!location || location.length < 1 || location.charAt(0) != "/" && location.indexOf("#/") !== 0) {
  		throw Error("Invalid parameter location");
  	}

  	// Execute this code when the current call stack is complete
  	setTimeout(
  		() => {
  			window.location.hash = (location.charAt(0) == "#" ? "" : "#") + location;
  		},
  		0
  	);
  }

  function instance$m($$self, $$props, $$invalidate) {
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
  		init(this, options, instance$m, create_fragment$n, safe_not_equal, { routes: 2, prefix: 3 });
  	}
  }

  var candidateSelectors = [
    'input',
    'select',
    'textarea',
    'a[href]',
    'button',
    '[tabindex]',
    'audio[controls]',
    'video[controls]',
    '[contenteditable]:not([contenteditable="false"])',
  ];
  var candidateSelector = candidateSelectors.join(',');

  var matches$1 = typeof Element === 'undefined'
    ? function () {}
    : Element.prototype.matches || Element.prototype.msMatchesSelector || Element.prototype.webkitMatchesSelector;

  function tabbable(el, options) {
    options = options || {};

    var regularTabbables = [];
    var orderedTabbables = [];

    var candidates = el.querySelectorAll(candidateSelector);

    if (options.includeContainer) {
      if (matches$1.call(el, candidateSelector)) {
        candidates = Array.prototype.slice.apply(candidates);
        candidates.unshift(el);
      }
    }

    var i, candidate, candidateTabindex;
    for (i = 0; i < candidates.length; i++) {
      candidate = candidates[i];

      if (!isNodeMatchingSelectorTabbable(candidate)) continue;

      candidateTabindex = getTabindex(candidate);
      if (candidateTabindex === 0) {
        regularTabbables.push(candidate);
      } else {
        orderedTabbables.push({
          documentOrder: i,
          tabIndex: candidateTabindex,
          node: candidate,
        });
      }
    }

    var tabbableNodes = orderedTabbables
      .sort(sortOrderedTabbables)
      .map(function(a) { return a.node })
      .concat(regularTabbables);

    return tabbableNodes;
  }

  tabbable.isTabbable = isTabbable;
  tabbable.isFocusable = isFocusable;

  function isNodeMatchingSelectorTabbable(node) {
    if (
      !isNodeMatchingSelectorFocusable(node)
      || isNonTabbableRadio(node)
      || getTabindex(node) < 0
    ) {
      return false;
    }
    return true;
  }

  function isTabbable(node) {
    if (!node) throw new Error('No node provided');
    if (matches$1.call(node, candidateSelector) === false) return false;
    return isNodeMatchingSelectorTabbable(node);
  }

  function isNodeMatchingSelectorFocusable(node) {
    if (
      node.disabled
      || isHiddenInput(node)
      || isHidden(node)
    ) {
      return false;
    }
    return true;
  }

  var focusableCandidateSelector = candidateSelectors.concat('iframe').join(',');
  function isFocusable(node) {
    if (!node) throw new Error('No node provided');
    if (matches$1.call(node, focusableCandidateSelector) === false) return false;
    return isNodeMatchingSelectorFocusable(node);
  }

  function getTabindex(node) {
    var tabindexAttr = parseInt(node.getAttribute('tabindex'), 10);
    if (!isNaN(tabindexAttr)) return tabindexAttr;
    // Browsers do not return `tabIndex` correctly for contentEditable nodes;
    // so if they don't have a tabindex attribute specifically set, assume it's 0.
    if (isContentEditable(node)) return 0;
    return node.tabIndex;
  }

  function sortOrderedTabbables(a, b) {
    return a.tabIndex === b.tabIndex ? a.documentOrder - b.documentOrder : a.tabIndex - b.tabIndex;
  }

  function isContentEditable(node) {
    return node.contentEditable === 'true';
  }

  function isInput(node) {
    return node.tagName === 'INPUT';
  }

  function isHiddenInput(node) {
    return isInput(node) && node.type === 'hidden';
  }

  function isRadio(node) {
    return isInput(node) && node.type === 'radio';
  }

  function isNonTabbableRadio(node) {
    return isRadio(node) && !isTabbableRadio(node);
  }

  function getCheckedRadio(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].checked) {
        return nodes[i];
      }
    }
  }

  function isTabbableRadio(node) {
    if (!node.name) return true;
    // This won't account for the edge case where you have radio groups with the same
    // in separate forms on the same page.
    var radioSet = node.ownerDocument.querySelectorAll('input[type="radio"][name="' + node.name + '"]');
    var checked = getCheckedRadio(radioSet);
    return !checked || checked === node;
  }

  function isHidden(node) {
    // offsetParent being null will allow detecting cases where an element is invisible or inside an invisible element,
    // as long as the element does not use position: fixed. For them, their visibility has to be checked directly as well.
    return node.offsetParent === null || getComputedStyle(node).visibility === 'hidden';
  }

  var tabbable_1 = tabbable;

  var immutable = extend;

  var hasOwnProperty = Object.prototype.hasOwnProperty;

  function extend() {
      var target = {};

      for (var i = 0; i < arguments.length; i++) {
          var source = arguments[i];

          for (var key in source) {
              if (hasOwnProperty.call(source, key)) {
                  target[key] = source[key];
              }
          }
      }

      return target
  }

  var activeFocusDelay;

  var activeFocusTraps = (function() {
    var trapQueue = [];
    return {
      activateTrap: function(trap) {
        if (trapQueue.length > 0) {
          var activeTrap = trapQueue[trapQueue.length - 1];
          if (activeTrap !== trap) {
            activeTrap.pause();
          }
        }

        var trapIndex = trapQueue.indexOf(trap);
        if (trapIndex === -1) {
          trapQueue.push(trap);
        } else {
          // move this existing trap to the front of the queue
          trapQueue.splice(trapIndex, 1);
          trapQueue.push(trap);
        }
      },

      deactivateTrap: function(trap) {
        var trapIndex = trapQueue.indexOf(trap);
        if (trapIndex !== -1) {
          trapQueue.splice(trapIndex, 1);
        }

        if (trapQueue.length > 0) {
          trapQueue[trapQueue.length - 1].unpause();
        }
      }
    };
  })();

  function focusTrap(element, userOptions) {
    var doc = document;
    var container =
      typeof element === 'string' ? doc.querySelector(element) : element;

    var config = immutable(
      {
        returnFocusOnDeactivate: true,
        escapeDeactivates: true
      },
      userOptions
    );

    var state = {
      firstTabbableNode: null,
      lastTabbableNode: null,
      nodeFocusedBeforeActivation: null,
      mostRecentlyFocusedNode: null,
      active: false,
      paused: false
    };

    var trap = {
      activate: activate,
      deactivate: deactivate,
      pause: pause,
      unpause: unpause
    };

    return trap;

    function activate(activateOptions) {
      if (state.active) return;

      updateTabbableNodes();

      state.active = true;
      state.paused = false;
      state.nodeFocusedBeforeActivation = doc.activeElement;

      var onActivate =
        activateOptions && activateOptions.onActivate
          ? activateOptions.onActivate
          : config.onActivate;
      if (onActivate) {
        onActivate();
      }

      addListeners();
      return trap;
    }

    function deactivate(deactivateOptions) {
      if (!state.active) return;

      clearTimeout(activeFocusDelay);

      removeListeners();
      state.active = false;
      state.paused = false;

      activeFocusTraps.deactivateTrap(trap);

      var onDeactivate =
        deactivateOptions && deactivateOptions.onDeactivate !== undefined
          ? deactivateOptions.onDeactivate
          : config.onDeactivate;
      if (onDeactivate) {
        onDeactivate();
      }

      var returnFocus =
        deactivateOptions && deactivateOptions.returnFocus !== undefined
          ? deactivateOptions.returnFocus
          : config.returnFocusOnDeactivate;
      if (returnFocus) {
        delay(function() {
          tryFocus(getReturnFocusNode(state.nodeFocusedBeforeActivation));
        });
      }

      return trap;
    }

    function pause() {
      if (state.paused || !state.active) return;
      state.paused = true;
      removeListeners();
    }

    function unpause() {
      if (!state.paused || !state.active) return;
      state.paused = false;
      updateTabbableNodes();
      addListeners();
    }

    function addListeners() {
      if (!state.active) return;

      // There can be only one listening focus trap at a time
      activeFocusTraps.activateTrap(trap);

      // Delay ensures that the focused element doesn't capture the event
      // that caused the focus trap activation.
      activeFocusDelay = delay(function() {
        tryFocus(getInitialFocusNode());
      });

      doc.addEventListener('focusin', checkFocusIn, true);
      doc.addEventListener('mousedown', checkPointerDown, {
        capture: true,
        passive: false
      });
      doc.addEventListener('touchstart', checkPointerDown, {
        capture: true,
        passive: false
      });
      doc.addEventListener('click', checkClick, {
        capture: true,
        passive: false
      });
      doc.addEventListener('keydown', checkKey, {
        capture: true,
        passive: false
      });

      return trap;
    }

    function removeListeners() {
      if (!state.active) return;

      doc.removeEventListener('focusin', checkFocusIn, true);
      doc.removeEventListener('mousedown', checkPointerDown, true);
      doc.removeEventListener('touchstart', checkPointerDown, true);
      doc.removeEventListener('click', checkClick, true);
      doc.removeEventListener('keydown', checkKey, true);

      return trap;
    }

    function getNodeForOption(optionName) {
      var optionValue = config[optionName];
      var node = optionValue;
      if (!optionValue) {
        return null;
      }
      if (typeof optionValue === 'string') {
        node = doc.querySelector(optionValue);
        if (!node) {
          throw new Error('`' + optionName + '` refers to no known node');
        }
      }
      if (typeof optionValue === 'function') {
        node = optionValue();
        if (!node) {
          throw new Error('`' + optionName + '` did not return a node');
        }
      }
      return node;
    }

    function getInitialFocusNode() {
      var node;
      if (getNodeForOption('initialFocus') !== null) {
        node = getNodeForOption('initialFocus');
      } else if (container.contains(doc.activeElement)) {
        node = doc.activeElement;
      } else {
        node = state.firstTabbableNode || getNodeForOption('fallbackFocus');
      }

      if (!node) {
        throw new Error(
          'Your focus-trap needs to have at least one focusable element'
        );
      }

      return node;
    }

    function getReturnFocusNode(previousActiveElement) {
      var node = getNodeForOption('setReturnFocus');
      return node ? node : previousActiveElement;
    }

    // This needs to be done on mousedown and touchstart instead of click
    // so that it precedes the focus event.
    function checkPointerDown(e) {
      if (container.contains(e.target)) return;
      if (config.clickOutsideDeactivates) {
        deactivate({
          returnFocus: !tabbable_1.isFocusable(e.target)
        });
        return;
      }
      // This is needed for mobile devices.
      // (If we'll only let `click` events through,
      // then on mobile they will be blocked anyways if `touchstart` is blocked.)
      if (config.allowOutsideClick && config.allowOutsideClick(e)) {
        return;
      }
      e.preventDefault();
    }

    // In case focus escapes the trap for some strange reason, pull it back in.
    function checkFocusIn(e) {
      // In Firefox when you Tab out of an iframe the Document is briefly focused.
      if (container.contains(e.target) || e.target instanceof Document) {
        return;
      }
      e.stopImmediatePropagation();
      tryFocus(state.mostRecentlyFocusedNode || getInitialFocusNode());
    }

    function checkKey(e) {
      if (config.escapeDeactivates !== false && isEscapeEvent(e)) {
        e.preventDefault();
        deactivate();
        return;
      }
      if (isTabEvent(e)) {
        checkTab(e);
        return;
      }
    }

    // Hijack Tab events on the first and last focusable nodes of the trap,
    // in order to prevent focus from escaping. If it escapes for even a
    // moment it can end up scrolling the page and causing confusion so we
    // kind of need to capture the action at the keydown phase.
    function checkTab(e) {
      updateTabbableNodes();
      if (e.shiftKey && e.target === state.firstTabbableNode) {
        e.preventDefault();
        tryFocus(state.lastTabbableNode);
        return;
      }
      if (!e.shiftKey && e.target === state.lastTabbableNode) {
        e.preventDefault();
        tryFocus(state.firstTabbableNode);
        return;
      }
    }

    function checkClick(e) {
      if (config.clickOutsideDeactivates) return;
      if (container.contains(e.target)) return;
      if (config.allowOutsideClick && config.allowOutsideClick(e)) {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    function updateTabbableNodes() {
      var tabbableNodes = tabbable_1(container);
      state.firstTabbableNode = tabbableNodes[0] || getInitialFocusNode();
      state.lastTabbableNode =
        tabbableNodes[tabbableNodes.length - 1] || getInitialFocusNode();
    }

    function tryFocus(node) {
      if (node === doc.activeElement) return;
      if (!node || !node.focus) {
        tryFocus(getInitialFocusNode());
        return;
      }
      node.focus();
      state.mostRecentlyFocusedNode = node;
      if (isSelectableInput(node)) {
        node.select();
      }
    }
  }

  function isSelectableInput(node) {
    return (
      node.tagName &&
      node.tagName.toLowerCase() === 'input' &&
      typeof node.select === 'function'
    );
  }

  function isEscapeEvent(e) {
    return e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27;
  }

  function isTabEvent(e) {
    return e.key === 'Tab' || e.keyCode === 9;
  }

  function delay(fn) {
    return setTimeout(fn, 0);
  }

  var focusTrap_1 = focusTrap;

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
  function createFocusTrapInstance(surfaceEl, focusTrapFactory) {
      if (focusTrapFactory === void 0) { focusTrapFactory = focusTrap_1; }
      return focusTrapFactory(surfaceEl, {
          clickOutsideDeactivates: true,
          escapeDeactivates: false,
          initialFocus: undefined,
          returnFocusOnDeactivate: false,
      });
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
  var cssClasses$a = {
      LIST_ITEM_ACTIVATED_CLASS: 'mdc-list-item--activated',
      LIST_ITEM_CLASS: 'mdc-list-item',
      LIST_ITEM_DISABLED_CLASS: 'mdc-list-item--disabled',
      LIST_ITEM_SELECTED_CLASS: 'mdc-list-item--selected',
      ROOT: 'mdc-list',
  };
  var strings$8 = {
      ACTION_EVENT: 'MDCList:action',
      ARIA_CHECKED: 'aria-checked',
      ARIA_CHECKED_CHECKBOX_SELECTOR: '[role="checkbox"][aria-checked="true"]',
      ARIA_CHECKED_RADIO_SELECTOR: '[role="radio"][aria-checked="true"]',
      ARIA_CURRENT: 'aria-current',
      ARIA_DISABLED: 'aria-disabled',
      ARIA_ORIENTATION: 'aria-orientation',
      ARIA_ORIENTATION_HORIZONTAL: 'horizontal',
      ARIA_ROLE_CHECKBOX_SELECTOR: '[role="checkbox"]',
      ARIA_SELECTED: 'aria-selected',
      CHECKBOX_RADIO_SELECTOR: 'input[type="checkbox"]:not(:disabled), input[type="radio"]:not(:disabled)',
      CHECKBOX_SELECTOR: 'input[type="checkbox"]:not(:disabled)',
      CHILD_ELEMENTS_TO_TOGGLE_TABINDEX: "\n    ." + cssClasses$a.LIST_ITEM_CLASS + " button:not(:disabled),\n    ." + cssClasses$a.LIST_ITEM_CLASS + " a\n  ",
      FOCUSABLE_CHILD_ELEMENTS: "\n    ." + cssClasses$a.LIST_ITEM_CLASS + " button:not(:disabled),\n    ." + cssClasses$a.LIST_ITEM_CLASS + " a,\n    ." + cssClasses$a.LIST_ITEM_CLASS + " input[type=\"radio\"]:not(:disabled),\n    ." + cssClasses$a.LIST_ITEM_CLASS + " input[type=\"checkbox\"]:not(:disabled)\n  ",
      RADIO_SELECTOR: 'input[type="radio"]:not(:disabled)',
  };
  var numbers$3 = {
      UNSET_INDEX: -1,
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
  var ELEMENTS_KEY_ALLOWED_IN = ['input', 'button', 'textarea', 'select'];
  function isNumberArray(selectedIndex) {
      return selectedIndex instanceof Array;
  }
  var MDCListFoundation = /** @class */ (function (_super) {
      __extends(MDCListFoundation, _super);
      function MDCListFoundation(adapter) {
          var _this = _super.call(this, __assign({}, MDCListFoundation.defaultAdapter, adapter)) || this;
          _this.wrapFocus_ = false;
          _this.isVertical_ = true;
          _this.isSingleSelectionList_ = false;
          _this.selectedIndex_ = numbers$3.UNSET_INDEX;
          _this.focusedItemIndex_ = numbers$3.UNSET_INDEX;
          _this.useActivatedClass_ = false;
          _this.ariaCurrentAttrValue_ = null;
          _this.isCheckboxList_ = false;
          _this.isRadioList_ = false;
          return _this;
      }
      Object.defineProperty(MDCListFoundation, "strings", {
          get: function () {
              return strings$8;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCListFoundation, "cssClasses", {
          get: function () {
              return cssClasses$a;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCListFoundation, "numbers", {
          get: function () {
              return numbers$3;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCListFoundation, "defaultAdapter", {
          get: function () {
              return {
                  addClassForElementIndex: function () { return undefined; },
                  focusItemAtIndex: function () { return undefined; },
                  getAttributeForElementIndex: function () { return null; },
                  getFocusedElementIndex: function () { return 0; },
                  getListItemCount: function () { return 0; },
                  hasCheckboxAtIndex: function () { return false; },
                  hasRadioAtIndex: function () { return false; },
                  isCheckboxCheckedAtIndex: function () { return false; },
                  isFocusInsideList: function () { return false; },
                  isRootFocused: function () { return false; },
                  notifyAction: function () { return undefined; },
                  removeClassForElementIndex: function () { return undefined; },
                  setAttributeForElementIndex: function () { return undefined; },
                  setCheckedCheckboxOrRadioAtIndex: function () { return undefined; },
                  setTabIndexForListItemChildren: function () { return undefined; },
              };
          },
          enumerable: true,
          configurable: true
      });
      MDCListFoundation.prototype.layout = function () {
          if (this.adapter_.getListItemCount() === 0) {
              return;
          }
          if (this.adapter_.hasCheckboxAtIndex(0)) {
              this.isCheckboxList_ = true;
          }
          else if (this.adapter_.hasRadioAtIndex(0)) {
              this.isRadioList_ = true;
          }
      };
      /**
       * Sets the private wrapFocus_ variable.
       */
      MDCListFoundation.prototype.setWrapFocus = function (value) {
          this.wrapFocus_ = value;
      };
      /**
       * Sets the isVertical_ private variable.
       */
      MDCListFoundation.prototype.setVerticalOrientation = function (value) {
          this.isVertical_ = value;
      };
      /**
       * Sets the isSingleSelectionList_ private variable.
       */
      MDCListFoundation.prototype.setSingleSelection = function (value) {
          this.isSingleSelectionList_ = value;
      };
      /**
       * Sets the useActivatedClass_ private variable.
       */
      MDCListFoundation.prototype.setUseActivatedClass = function (useActivated) {
          this.useActivatedClass_ = useActivated;
      };
      MDCListFoundation.prototype.getSelectedIndex = function () {
          return this.selectedIndex_;
      };
      MDCListFoundation.prototype.setSelectedIndex = function (index) {
          if (!this.isIndexValid_(index)) {
              return;
          }
          if (this.isCheckboxList_) {
              this.setCheckboxAtIndex_(index);
          }
          else if (this.isRadioList_) {
              this.setRadioAtIndex_(index);
          }
          else {
              this.setSingleSelectionAtIndex_(index);
          }
      };
      /**
       * Focus in handler for the list items.
       */
      MDCListFoundation.prototype.handleFocusIn = function (_, listItemIndex) {
          if (listItemIndex >= 0) {
              this.adapter_.setTabIndexForListItemChildren(listItemIndex, '0');
          }
      };
      /**
       * Focus out handler for the list items.
       */
      MDCListFoundation.prototype.handleFocusOut = function (_, listItemIndex) {
          var _this = this;
          if (listItemIndex >= 0) {
              this.adapter_.setTabIndexForListItemChildren(listItemIndex, '-1');
          }
          /**
           * Between Focusout & Focusin some browsers do not have focus on any element. Setting a delay to wait till the focus
           * is moved to next element.
           */
          setTimeout(function () {
              if (!_this.adapter_.isFocusInsideList()) {
                  _this.setTabindexToFirstSelectedItem_();
              }
          }, 0);
      };
      /**
       * Key handler for the list.
       */
      MDCListFoundation.prototype.handleKeydown = function (evt, isRootListItem, listItemIndex) {
          var isArrowLeft = evt.key === 'ArrowLeft' || evt.keyCode === 37;
          var isArrowUp = evt.key === 'ArrowUp' || evt.keyCode === 38;
          var isArrowRight = evt.key === 'ArrowRight' || evt.keyCode === 39;
          var isArrowDown = evt.key === 'ArrowDown' || evt.keyCode === 40;
          var isHome = evt.key === 'Home' || evt.keyCode === 36;
          var isEnd = evt.key === 'End' || evt.keyCode === 35;
          var isEnter = evt.key === 'Enter' || evt.keyCode === 13;
          var isSpace = evt.key === 'Space' || evt.keyCode === 32;
          if (this.adapter_.isRootFocused()) {
              if (isArrowUp || isEnd) {
                  evt.preventDefault();
                  this.focusLastElement();
              }
              else if (isArrowDown || isHome) {
                  evt.preventDefault();
                  this.focusFirstElement();
              }
              return;
          }
          var currentIndex = this.adapter_.getFocusedElementIndex();
          if (currentIndex === -1) {
              currentIndex = listItemIndex;
              if (currentIndex < 0) {
                  // If this event doesn't have a mdc-list-item ancestor from the
                  // current list (not from a sublist), return early.
                  return;
              }
          }
          var nextIndex;
          if ((this.isVertical_ && isArrowDown) || (!this.isVertical_ && isArrowRight)) {
              this.preventDefaultEvent_(evt);
              nextIndex = this.focusNextElement(currentIndex);
          }
          else if ((this.isVertical_ && isArrowUp) || (!this.isVertical_ && isArrowLeft)) {
              this.preventDefaultEvent_(evt);
              nextIndex = this.focusPrevElement(currentIndex);
          }
          else if (isHome) {
              this.preventDefaultEvent_(evt);
              nextIndex = this.focusFirstElement();
          }
          else if (isEnd) {
              this.preventDefaultEvent_(evt);
              nextIndex = this.focusLastElement();
          }
          else if (isEnter || isSpace) {
              if (isRootListItem) {
                  // Return early if enter key is pressed on anchor element which triggers synthetic MouseEvent event.
                  var target = evt.target;
                  if (target && target.tagName === 'A' && isEnter) {
                      return;
                  }
                  this.preventDefaultEvent_(evt);
                  if (this.isSelectableList_()) {
                      this.setSelectedIndexOnAction_(currentIndex);
                  }
                  this.adapter_.notifyAction(currentIndex);
              }
          }
          this.focusedItemIndex_ = currentIndex;
          if (nextIndex !== undefined) {
              this.setTabindexAtIndex_(nextIndex);
              this.focusedItemIndex_ = nextIndex;
          }
      };
      /**
       * Click handler for the list.
       */
      MDCListFoundation.prototype.handleClick = function (index, toggleCheckbox) {
          if (index === numbers$3.UNSET_INDEX) {
              return;
          }
          if (this.isSelectableList_()) {
              this.setSelectedIndexOnAction_(index, toggleCheckbox);
          }
          this.adapter_.notifyAction(index);
          this.setTabindexAtIndex_(index);
          this.focusedItemIndex_ = index;
      };
      /**
       * Focuses the next element on the list.
       */
      MDCListFoundation.prototype.focusNextElement = function (index) {
          var count = this.adapter_.getListItemCount();
          var nextIndex = index + 1;
          if (nextIndex >= count) {
              if (this.wrapFocus_) {
                  nextIndex = 0;
              }
              else {
                  // Return early because last item is already focused.
                  return index;
              }
          }
          this.adapter_.focusItemAtIndex(nextIndex);
          return nextIndex;
      };
      /**
       * Focuses the previous element on the list.
       */
      MDCListFoundation.prototype.focusPrevElement = function (index) {
          var prevIndex = index - 1;
          if (prevIndex < 0) {
              if (this.wrapFocus_) {
                  prevIndex = this.adapter_.getListItemCount() - 1;
              }
              else {
                  // Return early because first item is already focused.
                  return index;
              }
          }
          this.adapter_.focusItemAtIndex(prevIndex);
          return prevIndex;
      };
      MDCListFoundation.prototype.focusFirstElement = function () {
          this.adapter_.focusItemAtIndex(0);
          return 0;
      };
      MDCListFoundation.prototype.focusLastElement = function () {
          var lastIndex = this.adapter_.getListItemCount() - 1;
          this.adapter_.focusItemAtIndex(lastIndex);
          return lastIndex;
      };
      /**
       * @param itemIndex Index of the list item
       * @param isEnabled Sets the list item to enabled or disabled.
       */
      MDCListFoundation.prototype.setEnabled = function (itemIndex, isEnabled) {
          if (!this.isIndexValid_(itemIndex)) {
              return;
          }
          if (isEnabled) {
              this.adapter_.removeClassForElementIndex(itemIndex, cssClasses$a.LIST_ITEM_DISABLED_CLASS);
              this.adapter_.setAttributeForElementIndex(itemIndex, strings$8.ARIA_DISABLED, 'false');
          }
          else {
              this.adapter_.addClassForElementIndex(itemIndex, cssClasses$a.LIST_ITEM_DISABLED_CLASS);
              this.adapter_.setAttributeForElementIndex(itemIndex, strings$8.ARIA_DISABLED, 'true');
          }
      };
      /**
       * Ensures that preventDefault is only called if the containing element doesn't
       * consume the event, and it will cause an unintended scroll.
       */
      MDCListFoundation.prototype.preventDefaultEvent_ = function (evt) {
          var target = evt.target;
          var tagName = ("" + target.tagName).toLowerCase();
          if (ELEMENTS_KEY_ALLOWED_IN.indexOf(tagName) === -1) {
              evt.preventDefault();
          }
      };
      MDCListFoundation.prototype.setSingleSelectionAtIndex_ = function (index) {
          if (this.selectedIndex_ === index) {
              return;
          }
          var selectedClassName = cssClasses$a.LIST_ITEM_SELECTED_CLASS;
          if (this.useActivatedClass_) {
              selectedClassName = cssClasses$a.LIST_ITEM_ACTIVATED_CLASS;
          }
          if (this.selectedIndex_ !== numbers$3.UNSET_INDEX) {
              this.adapter_.removeClassForElementIndex(this.selectedIndex_, selectedClassName);
          }
          this.adapter_.addClassForElementIndex(index, selectedClassName);
          this.setAriaForSingleSelectionAtIndex_(index);
          this.selectedIndex_ = index;
      };
      /**
       * Sets aria attribute for single selection at given index.
       */
      MDCListFoundation.prototype.setAriaForSingleSelectionAtIndex_ = function (index) {
          // Detect the presence of aria-current and get the value only during list initialization when it is in unset state.
          if (this.selectedIndex_ === numbers$3.UNSET_INDEX) {
              this.ariaCurrentAttrValue_ =
                  this.adapter_.getAttributeForElementIndex(index, strings$8.ARIA_CURRENT);
          }
          var isAriaCurrent = this.ariaCurrentAttrValue_ !== null;
          var ariaAttribute = isAriaCurrent ? strings$8.ARIA_CURRENT : strings$8.ARIA_SELECTED;
          if (this.selectedIndex_ !== numbers$3.UNSET_INDEX) {
              this.adapter_.setAttributeForElementIndex(this.selectedIndex_, ariaAttribute, 'false');
          }
          var ariaAttributeValue = isAriaCurrent ? this.ariaCurrentAttrValue_ : 'true';
          this.adapter_.setAttributeForElementIndex(index, ariaAttribute, ariaAttributeValue);
      };
      /**
       * Toggles radio at give index. Radio doesn't change the checked state if it is already checked.
       */
      MDCListFoundation.prototype.setRadioAtIndex_ = function (index) {
          this.adapter_.setCheckedCheckboxOrRadioAtIndex(index, true);
          if (this.selectedIndex_ !== numbers$3.UNSET_INDEX) {
              this.adapter_.setAttributeForElementIndex(this.selectedIndex_, strings$8.ARIA_CHECKED, 'false');
          }
          this.adapter_.setAttributeForElementIndex(index, strings$8.ARIA_CHECKED, 'true');
          this.selectedIndex_ = index;
      };
      MDCListFoundation.prototype.setCheckboxAtIndex_ = function (index) {
          for (var i = 0; i < this.adapter_.getListItemCount(); i++) {
              var isChecked = false;
              if (index.indexOf(i) >= 0) {
                  isChecked = true;
              }
              this.adapter_.setCheckedCheckboxOrRadioAtIndex(i, isChecked);
              this.adapter_.setAttributeForElementIndex(i, strings$8.ARIA_CHECKED, isChecked ? 'true' : 'false');
          }
          this.selectedIndex_ = index;
      };
      MDCListFoundation.prototype.setTabindexAtIndex_ = function (index) {
          if (this.focusedItemIndex_ === numbers$3.UNSET_INDEX && index !== 0) {
              // If no list item was selected set first list item's tabindex to -1.
              // Generally, tabindex is set to 0 on first list item of list that has no preselected items.
              this.adapter_.setAttributeForElementIndex(0, 'tabindex', '-1');
          }
          else if (this.focusedItemIndex_ >= 0 && this.focusedItemIndex_ !== index) {
              this.adapter_.setAttributeForElementIndex(this.focusedItemIndex_, 'tabindex', '-1');
          }
          this.adapter_.setAttributeForElementIndex(index, 'tabindex', '0');
      };
      /**
       * @return Return true if it is single selectin list, checkbox list or radio list.
       */
      MDCListFoundation.prototype.isSelectableList_ = function () {
          return this.isSingleSelectionList_ || this.isCheckboxList_ || this.isRadioList_;
      };
      MDCListFoundation.prototype.setTabindexToFirstSelectedItem_ = function () {
          var targetIndex = 0;
          if (this.isSelectableList_()) {
              if (typeof this.selectedIndex_ === 'number' && this.selectedIndex_ !== numbers$3.UNSET_INDEX) {
                  targetIndex = this.selectedIndex_;
              }
              else if (isNumberArray(this.selectedIndex_) && this.selectedIndex_.length > 0) {
                  targetIndex = this.selectedIndex_.reduce(function (currentIndex, minIndex) { return Math.min(currentIndex, minIndex); });
              }
          }
          this.setTabindexAtIndex_(targetIndex);
      };
      MDCListFoundation.prototype.isIndexValid_ = function (index) {
          var _this = this;
          if (index instanceof Array) {
              if (!this.isCheckboxList_) {
                  throw new Error('MDCListFoundation: Array of index is only supported for checkbox based list');
              }
              if (index.length === 0) {
                  return true;
              }
              else {
                  return index.some(function (i) { return _this.isIndexInRange_(i); });
              }
          }
          else if (typeof index === 'number') {
              if (this.isCheckboxList_) {
                  throw new Error('MDCListFoundation: Expected array of index for checkbox based list but got number: ' + index);
              }
              return this.isIndexInRange_(index);
          }
          else {
              return false;
          }
      };
      MDCListFoundation.prototype.isIndexInRange_ = function (index) {
          var listSize = this.adapter_.getListItemCount();
          return index >= 0 && index < listSize;
      };
      MDCListFoundation.prototype.setSelectedIndexOnAction_ = function (index, toggleCheckbox) {
          if (toggleCheckbox === void 0) { toggleCheckbox = true; }
          if (this.isCheckboxList_) {
              this.toggleCheckboxAtIndex_(index, toggleCheckbox);
          }
          else {
              this.setSelectedIndex(index);
          }
      };
      MDCListFoundation.prototype.toggleCheckboxAtIndex_ = function (index, toggleCheckbox) {
          var isChecked = this.adapter_.isCheckboxCheckedAtIndex(index);
          if (toggleCheckbox) {
              isChecked = !isChecked;
              this.adapter_.setCheckedCheckboxOrRadioAtIndex(index, isChecked);
          }
          this.adapter_.setAttributeForElementIndex(index, strings$8.ARIA_CHECKED, isChecked ? 'true' : 'false');
          // If none of the checkbox items are selected and selectedIndex is not initialized then provide a default value.
          var selectedIndexes = this.selectedIndex_ === numbers$3.UNSET_INDEX ? [] : this.selectedIndex_.slice();
          if (isChecked) {
              selectedIndexes.push(index);
          }
          else {
              selectedIndexes = selectedIndexes.filter(function (i) { return i !== index; });
          }
          this.selectedIndex_ = selectedIndexes;
      };
      return MDCListFoundation;
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
  var MDCList = /** @class */ (function (_super) {
      __extends(MDCList, _super);
      function MDCList() {
          return _super !== null && _super.apply(this, arguments) || this;
      }
      Object.defineProperty(MDCList.prototype, "vertical", {
          set: function (value) {
              this.foundation_.setVerticalOrientation(value);
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCList.prototype, "listElements", {
          get: function () {
              return [].slice.call(this.root_.querySelectorAll("." + cssClasses$a.LIST_ITEM_CLASS));
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCList.prototype, "wrapFocus", {
          set: function (value) {
              this.foundation_.setWrapFocus(value);
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCList.prototype, "singleSelection", {
          set: function (isSingleSelectionList) {
              this.foundation_.setSingleSelection(isSingleSelectionList);
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCList.prototype, "selectedIndex", {
          get: function () {
              return this.foundation_.getSelectedIndex();
          },
          set: function (index) {
              this.foundation_.setSelectedIndex(index);
          },
          enumerable: true,
          configurable: true
      });
      MDCList.attachTo = function (root) {
          return new MDCList(root);
      };
      MDCList.prototype.initialSyncWithDOM = function () {
          this.handleClick_ = this.handleClickEvent_.bind(this);
          this.handleKeydown_ = this.handleKeydownEvent_.bind(this);
          this.focusInEventListener_ = this.handleFocusInEvent_.bind(this);
          this.focusOutEventListener_ = this.handleFocusOutEvent_.bind(this);
          this.listen('keydown', this.handleKeydown_);
          this.listen('click', this.handleClick_);
          this.listen('focusin', this.focusInEventListener_);
          this.listen('focusout', this.focusOutEventListener_);
          this.layout();
          this.initializeListType();
      };
      MDCList.prototype.destroy = function () {
          this.unlisten('keydown', this.handleKeydown_);
          this.unlisten('click', this.handleClick_);
          this.unlisten('focusin', this.focusInEventListener_);
          this.unlisten('focusout', this.focusOutEventListener_);
      };
      MDCList.prototype.layout = function () {
          var direction = this.root_.getAttribute(strings$8.ARIA_ORIENTATION);
          this.vertical = direction !== strings$8.ARIA_ORIENTATION_HORIZONTAL;
          // List items need to have at least tabindex=-1 to be focusable.
          [].slice.call(this.root_.querySelectorAll('.mdc-list-item:not([tabindex])'))
              .forEach(function (el) {
              el.setAttribute('tabindex', '-1');
          });
          // Child button/a elements are not tabbable until the list item is focused.
          [].slice.call(this.root_.querySelectorAll(strings$8.FOCUSABLE_CHILD_ELEMENTS))
              .forEach(function (el) { return el.setAttribute('tabindex', '-1'); });
          this.foundation_.layout();
      };
      /**
       * Initialize selectedIndex value based on pre-selected checkbox list items, single selection or radio.
       */
      MDCList.prototype.initializeListType = function () {
          var _this = this;
          var checkboxListItems = this.root_.querySelectorAll(strings$8.ARIA_ROLE_CHECKBOX_SELECTOR);
          var singleSelectedListItem = this.root_.querySelector("\n      ." + cssClasses$a.LIST_ITEM_ACTIVATED_CLASS + ",\n      ." + cssClasses$a.LIST_ITEM_SELECTED_CLASS + "\n    ");
          var radioSelectedListItem = this.root_.querySelector(strings$8.ARIA_CHECKED_RADIO_SELECTOR);
          if (checkboxListItems.length) {
              var preselectedItems = this.root_.querySelectorAll(strings$8.ARIA_CHECKED_CHECKBOX_SELECTOR);
              this.selectedIndex =
                  [].map.call(preselectedItems, function (listItem) { return _this.listElements.indexOf(listItem); });
          }
          else if (singleSelectedListItem) {
              if (singleSelectedListItem.classList.contains(cssClasses$a.LIST_ITEM_ACTIVATED_CLASS)) {
                  this.foundation_.setUseActivatedClass(true);
              }
              this.singleSelection = true;
              this.selectedIndex = this.listElements.indexOf(singleSelectedListItem);
          }
          else if (radioSelectedListItem) {
              this.selectedIndex = this.listElements.indexOf(radioSelectedListItem);
          }
      };
      /**
       * Updates the list item at itemIndex to the desired isEnabled state.
       * @param itemIndex Index of the list item
       * @param isEnabled Sets the list item to enabled or disabled.
       */
      MDCList.prototype.setEnabled = function (itemIndex, isEnabled) {
          this.foundation_.setEnabled(itemIndex, isEnabled);
      };
      MDCList.prototype.getDefaultFoundation = function () {
          var _this = this;
          // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
          // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
          var adapter = {
              addClassForElementIndex: function (index, className) {
                  var element = _this.listElements[index];
                  if (element) {
                      element.classList.add(className);
                  }
              },
              focusItemAtIndex: function (index) {
                  var element = _this.listElements[index];
                  if (element) {
                      element.focus();
                  }
              },
              getAttributeForElementIndex: function (index, attr) { return _this.listElements[index].getAttribute(attr); },
              getFocusedElementIndex: function () { return _this.listElements.indexOf(document.activeElement); },
              getListItemCount: function () { return _this.listElements.length; },
              hasCheckboxAtIndex: function (index) {
                  var listItem = _this.listElements[index];
                  return !!listItem.querySelector(strings$8.CHECKBOX_SELECTOR);
              },
              hasRadioAtIndex: function (index) {
                  var listItem = _this.listElements[index];
                  return !!listItem.querySelector(strings$8.RADIO_SELECTOR);
              },
              isCheckboxCheckedAtIndex: function (index) {
                  var listItem = _this.listElements[index];
                  var toggleEl = listItem.querySelector(strings$8.CHECKBOX_SELECTOR);
                  return toggleEl.checked;
              },
              isFocusInsideList: function () {
                  return _this.root_.contains(document.activeElement);
              },
              isRootFocused: function () { return document.activeElement === _this.root_; },
              notifyAction: function (index) {
                  _this.emit(strings$8.ACTION_EVENT, { index: index }, /** shouldBubble */ true);
              },
              removeClassForElementIndex: function (index, className) {
                  var element = _this.listElements[index];
                  if (element) {
                      element.classList.remove(className);
                  }
              },
              setAttributeForElementIndex: function (index, attr, value) {
                  var element = _this.listElements[index];
                  if (element) {
                      element.setAttribute(attr, value);
                  }
              },
              setCheckedCheckboxOrRadioAtIndex: function (index, isChecked) {
                  var listItem = _this.listElements[index];
                  var toggleEl = listItem.querySelector(strings$8.CHECKBOX_RADIO_SELECTOR);
                  toggleEl.checked = isChecked;
                  var event = document.createEvent('Event');
                  event.initEvent('change', true, true);
                  toggleEl.dispatchEvent(event);
              },
              setTabIndexForListItemChildren: function (listItemIndex, tabIndexValue) {
                  var element = _this.listElements[listItemIndex];
                  var listItemChildren = [].slice.call(element.querySelectorAll(strings$8.CHILD_ELEMENTS_TO_TOGGLE_TABINDEX));
                  listItemChildren.forEach(function (el) { return el.setAttribute('tabindex', tabIndexValue); });
              },
          };
          return new MDCListFoundation(adapter);
      };
      /**
       * Used to figure out which list item this event is targetting. Or returns -1 if
       * there is no list item
       */
      MDCList.prototype.getListItemIndex_ = function (evt) {
          var eventTarget = evt.target;
          var nearestParent = closest(eventTarget, "." + cssClasses$a.LIST_ITEM_CLASS + ", ." + cssClasses$a.ROOT);
          // Get the index of the element if it is a list item.
          if (nearestParent && matches(nearestParent, "." + cssClasses$a.LIST_ITEM_CLASS)) {
              return this.listElements.indexOf(nearestParent);
          }
          return -1;
      };
      /**
       * Used to figure out which element was clicked before sending the event to the foundation.
       */
      MDCList.prototype.handleFocusInEvent_ = function (evt) {
          var index = this.getListItemIndex_(evt);
          this.foundation_.handleFocusIn(evt, index);
      };
      /**
       * Used to figure out which element was clicked before sending the event to the foundation.
       */
      MDCList.prototype.handleFocusOutEvent_ = function (evt) {
          var index = this.getListItemIndex_(evt);
          this.foundation_.handleFocusOut(evt, index);
      };
      /**
       * Used to figure out which element was focused when keydown event occurred before sending the event to the
       * foundation.
       */
      MDCList.prototype.handleKeydownEvent_ = function (evt) {
          var index = this.getListItemIndex_(evt);
          var target = evt.target;
          this.foundation_.handleKeydown(evt, target.classList.contains(cssClasses$a.LIST_ITEM_CLASS), index);
      };
      /**
       * Used to figure out which element was clicked before sending the event to the foundation.
       */
      MDCList.prototype.handleClickEvent_ = function (evt) {
          var index = this.getListItemIndex_(evt);
          var target = evt.target;
          // Toggle the checkbox only if it's not the target of the event, or the checkbox will have 2 change events.
          var toggleCheckbox = !matches(target, strings$8.CHECKBOX_RADIO_SELECTOR);
          this.foundation_.handleClick(index, toggleCheckbox);
      };
      return MDCList;
  }(MDCComponent));

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
  var cssClasses$b = {
      ANIMATE: 'mdc-drawer--animate',
      CLOSING: 'mdc-drawer--closing',
      DISMISSIBLE: 'mdc-drawer--dismissible',
      MODAL: 'mdc-drawer--modal',
      OPEN: 'mdc-drawer--open',
      OPENING: 'mdc-drawer--opening',
      ROOT: 'mdc-drawer',
  };
  var strings$9 = {
      APP_CONTENT_SELECTOR: '.mdc-drawer-app-content',
      CLOSE_EVENT: 'MDCDrawer:closed',
      OPEN_EVENT: 'MDCDrawer:opened',
      SCRIM_SELECTOR: '.mdc-drawer-scrim',
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
  var MDCDismissibleDrawerFoundation = /** @class */ (function (_super) {
      __extends(MDCDismissibleDrawerFoundation, _super);
      function MDCDismissibleDrawerFoundation(adapter) {
          var _this = _super.call(this, __assign({}, MDCDismissibleDrawerFoundation.defaultAdapter, adapter)) || this;
          _this.animationFrame_ = 0;
          _this.animationTimer_ = 0;
          return _this;
      }
      Object.defineProperty(MDCDismissibleDrawerFoundation, "strings", {
          get: function () {
              return strings$9;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCDismissibleDrawerFoundation, "cssClasses", {
          get: function () {
              return cssClasses$b;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCDismissibleDrawerFoundation, "defaultAdapter", {
          get: function () {
              // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
              return {
                  addClass: function () { return undefined; },
                  removeClass: function () { return undefined; },
                  hasClass: function () { return false; },
                  elementHasClass: function () { return false; },
                  notifyClose: function () { return undefined; },
                  notifyOpen: function () { return undefined; },
                  saveFocus: function () { return undefined; },
                  restoreFocus: function () { return undefined; },
                  focusActiveNavigationItem: function () { return undefined; },
                  trapFocus: function () { return undefined; },
                  releaseFocus: function () { return undefined; },
              };
              // tslint:enable:object-literal-sort-keys
          },
          enumerable: true,
          configurable: true
      });
      MDCDismissibleDrawerFoundation.prototype.destroy = function () {
          if (this.animationFrame_) {
              cancelAnimationFrame(this.animationFrame_);
          }
          if (this.animationTimer_) {
              clearTimeout(this.animationTimer_);
          }
      };
      /**
       * Opens the drawer from the closed state.
       */
      MDCDismissibleDrawerFoundation.prototype.open = function () {
          var _this = this;
          if (this.isOpen() || this.isOpening() || this.isClosing()) {
              return;
          }
          this.adapter_.addClass(cssClasses$b.OPEN);
          this.adapter_.addClass(cssClasses$b.ANIMATE);
          // Wait a frame once display is no longer "none", to establish basis for animation
          this.runNextAnimationFrame_(function () {
              _this.adapter_.addClass(cssClasses$b.OPENING);
          });
          this.adapter_.saveFocus();
      };
      /**
       * Closes the drawer from the open state.
       */
      MDCDismissibleDrawerFoundation.prototype.close = function () {
          if (!this.isOpen() || this.isOpening() || this.isClosing()) {
              return;
          }
          this.adapter_.addClass(cssClasses$b.CLOSING);
      };
      /**
       * Returns true if the drawer is in the open position.
       * @return true if drawer is in open state.
       */
      MDCDismissibleDrawerFoundation.prototype.isOpen = function () {
          return this.adapter_.hasClass(cssClasses$b.OPEN);
      };
      /**
       * Returns true if the drawer is animating open.
       * @return true if drawer is animating open.
       */
      MDCDismissibleDrawerFoundation.prototype.isOpening = function () {
          return this.adapter_.hasClass(cssClasses$b.OPENING) || this.adapter_.hasClass(cssClasses$b.ANIMATE);
      };
      /**
       * Returns true if the drawer is animating closed.
       * @return true if drawer is animating closed.
       */
      MDCDismissibleDrawerFoundation.prototype.isClosing = function () {
          return this.adapter_.hasClass(cssClasses$b.CLOSING);
      };
      /**
       * Keydown handler to close drawer when key is escape.
       */
      MDCDismissibleDrawerFoundation.prototype.handleKeydown = function (evt) {
          var keyCode = evt.keyCode, key = evt.key;
          var isEscape = key === 'Escape' || keyCode === 27;
          if (isEscape) {
              this.close();
          }
      };
      /**
       * Handles the `transitionend` event when the drawer finishes opening/closing.
       */
      MDCDismissibleDrawerFoundation.prototype.handleTransitionEnd = function (evt) {
          var OPENING = cssClasses$b.OPENING, CLOSING = cssClasses$b.CLOSING, OPEN = cssClasses$b.OPEN, ANIMATE = cssClasses$b.ANIMATE, ROOT = cssClasses$b.ROOT;
          // In Edge, transitionend on ripple pseudo-elements yields a target without classList, so check for Element first.
          var isRootElement = this.isElement_(evt.target) && this.adapter_.elementHasClass(evt.target, ROOT);
          if (!isRootElement) {
              return;
          }
          if (this.isClosing()) {
              this.adapter_.removeClass(OPEN);
              this.closed_();
              this.adapter_.restoreFocus();
              this.adapter_.notifyClose();
          }
          else {
              this.adapter_.focusActiveNavigationItem();
              this.opened_();
              this.adapter_.notifyOpen();
          }
          this.adapter_.removeClass(ANIMATE);
          this.adapter_.removeClass(OPENING);
          this.adapter_.removeClass(CLOSING);
      };
      /**
       * Extension point for when drawer finishes open animation.
       */
      MDCDismissibleDrawerFoundation.prototype.opened_ = function () { }; // tslint:disable-line:no-empty
      /**
       * Extension point for when drawer finishes close animation.
       */
      MDCDismissibleDrawerFoundation.prototype.closed_ = function () { }; // tslint:disable-line:no-empty
      /**
       * Runs the given logic on the next animation frame, using setTimeout to factor in Firefox reflow behavior.
       */
      MDCDismissibleDrawerFoundation.prototype.runNextAnimationFrame_ = function (callback) {
          var _this = this;
          cancelAnimationFrame(this.animationFrame_);
          this.animationFrame_ = requestAnimationFrame(function () {
              _this.animationFrame_ = 0;
              clearTimeout(_this.animationTimer_);
              _this.animationTimer_ = setTimeout(callback, 0);
          });
      };
      MDCDismissibleDrawerFoundation.prototype.isElement_ = function (element) {
          // In Edge, transitionend on ripple pseudo-elements yields a target without classList.
          return Boolean(element.classList);
      };
      return MDCDismissibleDrawerFoundation;
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
  /* istanbul ignore next: subclass is not a branch statement */
  var MDCModalDrawerFoundation = /** @class */ (function (_super) {
      __extends(MDCModalDrawerFoundation, _super);
      function MDCModalDrawerFoundation() {
          return _super !== null && _super.apply(this, arguments) || this;
      }
      /**
       * Handles click event on scrim.
       */
      MDCModalDrawerFoundation.prototype.handleScrimClick = function () {
          this.close();
      };
      /**
       * Called when drawer finishes open animation.
       */
      MDCModalDrawerFoundation.prototype.opened_ = function () {
          this.adapter_.trapFocus();
      };
      /**
       * Called when drawer finishes close animation.
       */
      MDCModalDrawerFoundation.prototype.closed_ = function () {
          this.adapter_.releaseFocus();
      };
      return MDCModalDrawerFoundation;
  }(MDCDismissibleDrawerFoundation));

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
  var cssClasses$c = MDCDismissibleDrawerFoundation.cssClasses, strings$a = MDCDismissibleDrawerFoundation.strings;
  /**
   * @events `MDCDrawer:closed {}` Emits when the navigation drawer has closed.
   * @events `MDCDrawer:opened {}` Emits when the navigation drawer has opened.
   */
  var MDCDrawer = /** @class */ (function (_super) {
      __extends(MDCDrawer, _super);
      function MDCDrawer() {
          return _super !== null && _super.apply(this, arguments) || this;
      }
      MDCDrawer.attachTo = function (root) {
          return new MDCDrawer(root);
      };
      Object.defineProperty(MDCDrawer.prototype, "open", {
          /**
           * @return boolean Proxies to the foundation's `open`/`close` methods.
           * Also returns true if drawer is in the open position.
           */
          get: function () {
              return this.foundation_.isOpen();
          },
          /**
           * Toggles the drawer open and closed.
           */
          set: function (isOpen) {
              if (isOpen) {
                  this.foundation_.open();
              }
              else {
                  this.foundation_.close();
              }
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCDrawer.prototype, "list", {
          get: function () {
              return this.list_;
          },
          enumerable: true,
          configurable: true
      });
      MDCDrawer.prototype.initialize = function (focusTrapFactory, listFactory) {
          if (focusTrapFactory === void 0) { focusTrapFactory = focusTrap_1; }
          if (listFactory === void 0) { listFactory = function (el) { return new MDCList(el); }; }
          var listEl = this.root_.querySelector("." + MDCListFoundation.cssClasses.ROOT);
          if (listEl) {
              this.list_ = listFactory(listEl);
              this.list_.wrapFocus = true;
          }
          this.focusTrapFactory_ = focusTrapFactory;
      };
      MDCDrawer.prototype.initialSyncWithDOM = function () {
          var _this = this;
          var MODAL = cssClasses$c.MODAL;
          var SCRIM_SELECTOR = strings$a.SCRIM_SELECTOR;
          this.scrim_ = this.root_.parentNode.querySelector(SCRIM_SELECTOR);
          if (this.scrim_ && this.root_.classList.contains(MODAL)) {
              this.handleScrimClick_ = function () { return _this.foundation_.handleScrimClick(); };
              this.scrim_.addEventListener('click', this.handleScrimClick_);
              this.focusTrap_ = createFocusTrapInstance(this.root_, this.focusTrapFactory_);
          }
          this.handleKeydown_ = function (evt) { return _this.foundation_.handleKeydown(evt); };
          this.handleTransitionEnd_ = function (evt) { return _this.foundation_.handleTransitionEnd(evt); };
          this.listen('keydown', this.handleKeydown_);
          this.listen('transitionend', this.handleTransitionEnd_);
      };
      MDCDrawer.prototype.destroy = function () {
          this.unlisten('keydown', this.handleKeydown_);
          this.unlisten('transitionend', this.handleTransitionEnd_);
          if (this.list_) {
              this.list_.destroy();
          }
          var MODAL = cssClasses$c.MODAL;
          if (this.scrim_ && this.handleScrimClick_ && this.root_.classList.contains(MODAL)) {
              this.scrim_.removeEventListener('click', this.handleScrimClick_);
              // Ensure drawer is closed to hide scrim and release focus
              this.open = false;
          }
      };
      MDCDrawer.prototype.getDefaultFoundation = function () {
          var _this = this;
          // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
          // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
          // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
          var adapter = {
              addClass: function (className) { return _this.root_.classList.add(className); },
              removeClass: function (className) { return _this.root_.classList.remove(className); },
              hasClass: function (className) { return _this.root_.classList.contains(className); },
              elementHasClass: function (element, className) { return element.classList.contains(className); },
              saveFocus: function () { return _this.previousFocus_ = document.activeElement; },
              restoreFocus: function () {
                  var previousFocus = _this.previousFocus_;
                  if (previousFocus && previousFocus.focus && _this.root_.contains(document.activeElement)) {
                      previousFocus.focus();
                  }
              },
              focusActiveNavigationItem: function () {
                  var activeNavItemEl = _this.root_.querySelector("." + MDCListFoundation.cssClasses.LIST_ITEM_ACTIVATED_CLASS);
                  if (activeNavItemEl) {
                      activeNavItemEl.focus();
                  }
              },
              notifyClose: function () { return _this.emit(strings$a.CLOSE_EVENT, {}, true /* shouldBubble */); },
              notifyOpen: function () { return _this.emit(strings$a.OPEN_EVENT, {}, true /* shouldBubble */); },
              trapFocus: function () { return _this.focusTrap_.activate(); },
              releaseFocus: function () { return _this.focusTrap_.deactivate(); },
          };
          // tslint:enable:object-literal-sort-keys
          var DISMISSIBLE = cssClasses$c.DISMISSIBLE, MODAL = cssClasses$c.MODAL;
          if (this.root_.classList.contains(DISMISSIBLE)) {
              return new MDCDismissibleDrawerFoundation(adapter);
          }
          else if (this.root_.classList.contains(MODAL)) {
              return new MDCModalDrawerFoundation(adapter);
          }
          else {
              throw new Error("MDCDrawer: Failed to instantiate component. Supported variants are " + DISMISSIBLE + " and " + MODAL + ".");
          }
      };
      return MDCDrawer;
  }(MDCComponent));

  /* node_modules\@smui\drawer\Drawer.svelte generated by Svelte v3.18.1 */

  function create_fragment$o(ctx) {
  	let aside;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[14].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[13], null);

  	let aside_levels = [
  		{
  			class: "\n    mdc-drawer\n    " + /*className*/ ctx[1] + "\n    " + (/*variant*/ ctx[2] === "dismissible"
  			? "mdc-drawer--dismissible"
  			: "") + "\n    " + (/*variant*/ ctx[2] === "modal"
  			? "mdc-drawer--modal"
  			: "") + "\n  "
  		},
  		exclude(/*$$props*/ ctx[6], ["use", "class", "variant", "open"])
  	];

  	let aside_data = {};

  	for (let i = 0; i < aside_levels.length; i += 1) {
  		aside_data = assign(aside_data, aside_levels[i]);
  	}

  	return {
  		c() {
  			aside = element("aside");
  			if (default_slot) default_slot.c();
  			set_attributes(aside, aside_data);
  		},
  		m(target, anchor) {
  			insert(target, aside, anchor);

  			if (default_slot) {
  				default_slot.m(aside, null);
  			}

  			/*aside_binding*/ ctx[15](aside);
  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, aside, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[4].call(null, aside)),
  				listen(aside, "MDCDrawer:opened", /*updateOpen*/ ctx[5]),
  				listen(aside, "MDCDrawer:closed", /*updateOpen*/ ctx[5])
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 8192) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[13], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[13], dirty, null));
  			}

  			set_attributes(aside, get_spread_update(aside_levels, [
  				dirty & /*className, variant*/ 6 && {
  					class: "\n    mdc-drawer\n    " + /*className*/ ctx[1] + "\n    " + (/*variant*/ ctx[2] === "dismissible"
  					? "mdc-drawer--dismissible"
  					: "") + "\n    " + (/*variant*/ ctx[2] === "modal"
  					? "mdc-drawer--modal"
  					: "") + "\n  "
  				},
  				dirty & /*exclude, $$props*/ 64 && exclude(/*$$props*/ ctx[6], ["use", "class", "variant", "open"])
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
  			if (detaching) detach(aside);
  			if (default_slot) default_slot.d(detaching);
  			/*aside_binding*/ ctx[15](null);
  			run_all(dispose);
  		}
  	};
  }

  function instance$n($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component, ["MDCDrawer:opened", "MDCDrawer:closed"]);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { variant = null } = $$props;
  	let { open = false } = $$props;
  	let element;
  	let drawer;
  	let listPromiseResolve;
  	let listPromise = new Promise(resolve => listPromiseResolve = resolve);
  	setContext("SMUI:list:nav", true);
  	setContext("SMUI:list:item:nav", true);

  	if (variant === "dismissible" || variant === "modal") {
  		setContext("SMUI:list:instantiate", false);
  		setContext("SMUI:list:getInstance", getListInstancePromise);
  	}

  	onMount(() => {
  		if (variant === "dismissible" || variant === "modal") {
  			$$invalidate(9, drawer = new MDCDrawer(element));
  			listPromiseResolve(drawer.list_);
  		}
  	});

  	onDestroy(() => {
  		drawer && drawer.destroy();
  	});

  	afterUpdate(() => {
  		if (drawer && !(variant === "dismissible" || variant === "modal")) {
  			drawer.destroy();
  			$$invalidate(9, drawer = undefined);
  		} else if (!drawer && (variant === "dismissible" || variant === "modal")) {
  			$$invalidate(9, drawer = new MDCDrawer(element));
  			listPromiseResolve(drawer.list_);
  		}
  	});

  	function getListInstancePromise() {
  		return listPromise;
  	}

  	function updateOpen() {
  		$$invalidate(7, open = drawer.open);
  	}

  	function setOpen(value) {
  		$$invalidate(7, open = value);
  	}

  	let { $$slots = {}, $$scope } = $$props;

  	function aside_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(3, element = $$value);
  		});
  	}

  	$$self.$set = $$new_props => {
  		$$invalidate(6, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("variant" in $$new_props) $$invalidate(2, variant = $$new_props.variant);
  		if ("open" in $$new_props) $$invalidate(7, open = $$new_props.open);
  		if ("$$scope" in $$new_props) $$invalidate(13, $$scope = $$new_props.$$scope);
  	};

  	$$self.$$.update = () => {
  		if ($$self.$$.dirty & /*drawer, open*/ 640) {
  			 if (drawer && drawer.open !== open) {
  				$$invalidate(9, drawer.open = open, drawer);
  			}
  		}
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		variant,
  		element,
  		forwardEvents,
  		updateOpen,
  		$$props,
  		open,
  		setOpen,
  		drawer,
  		listPromiseResolve,
  		listPromise,
  		getListInstancePromise,
  		$$scope,
  		$$slots,
  		aside_binding
  	];
  }

  class Drawer extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$n, create_fragment$o, safe_not_equal, {
  			use: 0,
  			class: 1,
  			variant: 2,
  			open: 7,
  			setOpen: 8
  		});
  	}

  	get setOpen() {
  		return this.$$.ctx[8];
  	}
  }

  var AppContent = classAdderBuilder({
    class: 'mdc-drawer-app-content',
    component: Div,
    contexts: {}
  });

  var Content = classAdderBuilder({
    class: 'mdc-drawer__content',
    component: Div,
    contexts: {}
  });

  var Header = classAdderBuilder({
    class: 'mdc-drawer__header',
    component: Div,
    contexts: {}
  });

  /* node_modules\@smui\common\H1.svelte generated by Svelte v3.18.1 */

  function create_fragment$p(ctx) {
  	let h1;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[4].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[3], null);
  	let h1_levels = [exclude(/*$$props*/ ctx[2], ["use"])];
  	let h1_data = {};

  	for (let i = 0; i < h1_levels.length; i += 1) {
  		h1_data = assign(h1_data, h1_levels[i]);
  	}

  	return {
  		c() {
  			h1 = element("h1");
  			if (default_slot) default_slot.c();
  			set_attributes(h1, h1_data);
  		},
  		m(target, anchor) {
  			insert(target, h1, anchor);

  			if (default_slot) {
  				default_slot.m(h1, null);
  			}

  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, h1, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[1].call(null, h1))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 8) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[3], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[3], dirty, null));
  			}

  			set_attributes(h1, get_spread_update(h1_levels, [dirty & /*exclude, $$props*/ 4 && exclude(/*$$props*/ ctx[2], ["use"])]));
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
  			if (detaching) detach(h1);
  			if (default_slot) default_slot.d(detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance$o($$self, $$props, $$invalidate) {
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

  class H1 extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$o, create_fragment$p, safe_not_equal, { use: 0 });
  	}
  }

  var Title = classAdderBuilder({
    class: 'mdc-drawer__title',
    component: H1,
    contexts: {}
  });

  /* node_modules\@smui\common\H2.svelte generated by Svelte v3.18.1 */

  function create_fragment$q(ctx) {
  	let h2;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[4].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[3], null);
  	let h2_levels = [exclude(/*$$props*/ ctx[2], ["use"])];
  	let h2_data = {};

  	for (let i = 0; i < h2_levels.length; i += 1) {
  		h2_data = assign(h2_data, h2_levels[i]);
  	}

  	return {
  		c() {
  			h2 = element("h2");
  			if (default_slot) default_slot.c();
  			set_attributes(h2, h2_data);
  		},
  		m(target, anchor) {
  			insert(target, h2, anchor);

  			if (default_slot) {
  				default_slot.m(h2, null);
  			}

  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, h2, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[1].call(null, h2))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 8) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[3], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[3], dirty, null));
  			}

  			set_attributes(h2, get_spread_update(h2_levels, [dirty & /*exclude, $$props*/ 4 && exclude(/*$$props*/ ctx[2], ["use"])]));
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
  			if (detaching) detach(h2);
  			if (default_slot) default_slot.d(detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance$p($$self, $$props, $$invalidate) {
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

  class H2 extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$p, create_fragment$q, safe_not_equal, { use: 0 });
  	}
  }

  var Subtitle = classAdderBuilder({
    class: 'mdc-drawer__subtitle',
    component: H2,
    contexts: {}
  });

  var Scrim = classAdderBuilder({
    class: 'mdc-drawer-scrim',
    component: Div,
    contexts: {}
  });

  /* node_modules\@smui\list\List.svelte generated by Svelte v3.18.1 */

  function create_else_block$4(ctx) {
  	let ul;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[29].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[28], null);

  	let ul_levels = [
  		{
  			class: "\n      mdc-list\n      " + /*className*/ ctx[1] + "\n      " + (/*nonInteractive*/ ctx[2]
  			? "mdc-list--non-interactive"
  			: "") + "\n      " + (/*dense*/ ctx[3] ? "mdc-list--dense" : "") + "\n      " + (/*avatarList*/ ctx[4] ? "mdc-list--avatar-list" : "") + "\n      " + (/*twoLine*/ ctx[5] ? "mdc-list--two-line" : "") + "\n      " + (/*threeLine*/ ctx[6] && !/*twoLine*/ ctx[5]
  			? "smui-list--three-line"
  			: "") + "\n    "
  		},
  		{ role: /*role*/ ctx[8] },
  		/*props*/ ctx[9]
  	];

  	let ul_data = {};

  	for (let i = 0; i < ul_levels.length; i += 1) {
  		ul_data = assign(ul_data, ul_levels[i]);
  	}

  	return {
  		c() {
  			ul = element("ul");
  			if (default_slot) default_slot.c();
  			set_attributes(ul, ul_data);
  		},
  		m(target, anchor) {
  			insert(target, ul, anchor);

  			if (default_slot) {
  				default_slot.m(ul, null);
  			}

  			/*ul_binding*/ ctx[31](ul);
  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, ul, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[10].call(null, ul)),
  				listen(ul, "MDCList:action", /*handleAction*/ ctx[12])
  			];
  		},
  		p(ctx, dirty) {
  			if (default_slot && default_slot.p && dirty[0] & /*$$scope*/ 268435456) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[28], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[28], dirty, null));
  			}

  			set_attributes(ul, get_spread_update(ul_levels, [
  				dirty[0] & /*className, nonInteractive, dense, avatarList, twoLine, threeLine*/ 126 && {
  					class: "\n      mdc-list\n      " + /*className*/ ctx[1] + "\n      " + (/*nonInteractive*/ ctx[2]
  					? "mdc-list--non-interactive"
  					: "") + "\n      " + (/*dense*/ ctx[3] ? "mdc-list--dense" : "") + "\n      " + (/*avatarList*/ ctx[4] ? "mdc-list--avatar-list" : "") + "\n      " + (/*twoLine*/ ctx[5] ? "mdc-list--two-line" : "") + "\n      " + (/*threeLine*/ ctx[6] && !/*twoLine*/ ctx[5]
  					? "smui-list--three-line"
  					: "") + "\n    "
  				},
  				dirty[0] & /*role*/ 256 && { role: /*role*/ ctx[8] },
  				dirty[0] & /*props*/ 512 && /*props*/ ctx[9]
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty[0] & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
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
  			if (detaching) detach(ul);
  			if (default_slot) default_slot.d(detaching);
  			/*ul_binding*/ ctx[31](null);
  			run_all(dispose);
  		}
  	};
  }

  // (1:0) {#if nav}
  function create_if_block$6(ctx) {
  	let nav_1;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[29].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[28], null);

  	let nav_1_levels = [
  		{
  			class: "\n      mdc-list\n      " + /*className*/ ctx[1] + "\n      " + (/*nonInteractive*/ ctx[2]
  			? "mdc-list--non-interactive"
  			: "") + "\n      " + (/*dense*/ ctx[3] ? "mdc-list--dense" : "") + "\n      " + (/*avatarList*/ ctx[4] ? "mdc-list--avatar-list" : "") + "\n      " + (/*twoLine*/ ctx[5] ? "mdc-list--two-line" : "") + "\n      " + (/*threeLine*/ ctx[6] && !/*twoLine*/ ctx[5]
  			? "smui-list--three-line"
  			: "") + "\n    "
  		},
  		/*props*/ ctx[9]
  	];

  	let nav_1_data = {};

  	for (let i = 0; i < nav_1_levels.length; i += 1) {
  		nav_1_data = assign(nav_1_data, nav_1_levels[i]);
  	}

  	return {
  		c() {
  			nav_1 = element("nav");
  			if (default_slot) default_slot.c();
  			set_attributes(nav_1, nav_1_data);
  		},
  		m(target, anchor) {
  			insert(target, nav_1, anchor);

  			if (default_slot) {
  				default_slot.m(nav_1, null);
  			}

  			/*nav_1_binding*/ ctx[30](nav_1);
  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, nav_1, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[10].call(null, nav_1)),
  				listen(nav_1, "MDCList:action", /*handleAction*/ ctx[12])
  			];
  		},
  		p(ctx, dirty) {
  			if (default_slot && default_slot.p && dirty[0] & /*$$scope*/ 268435456) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[28], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[28], dirty, null));
  			}

  			set_attributes(nav_1, get_spread_update(nav_1_levels, [
  				dirty[0] & /*className, nonInteractive, dense, avatarList, twoLine, threeLine*/ 126 && {
  					class: "\n      mdc-list\n      " + /*className*/ ctx[1] + "\n      " + (/*nonInteractive*/ ctx[2]
  					? "mdc-list--non-interactive"
  					: "") + "\n      " + (/*dense*/ ctx[3] ? "mdc-list--dense" : "") + "\n      " + (/*avatarList*/ ctx[4] ? "mdc-list--avatar-list" : "") + "\n      " + (/*twoLine*/ ctx[5] ? "mdc-list--two-line" : "") + "\n      " + (/*threeLine*/ ctx[6] && !/*twoLine*/ ctx[5]
  					? "smui-list--three-line"
  					: "") + "\n    "
  				},
  				dirty[0] & /*props*/ 512 && /*props*/ ctx[9]
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty[0] & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
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
  			if (detaching) detach(nav_1);
  			if (default_slot) default_slot.d(detaching);
  			/*nav_1_binding*/ ctx[30](null);
  			run_all(dispose);
  		}
  	};
  }

  function create_fragment$r(ctx) {
  	let current_block_type_index;
  	let if_block;
  	let if_block_anchor;
  	let current;
  	const if_block_creators = [create_if_block$6, create_else_block$4];
  	const if_blocks = [];

  	function select_block_type(ctx, dirty) {
  		if (/*nav*/ ctx[11]) return 0;
  		return 1;
  	}

  	current_block_type_index = select_block_type(ctx);
  	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

  	return {
  		c() {
  			if_block.c();
  			if_block_anchor = empty();
  		},
  		m(target, anchor) {
  			if_blocks[current_block_type_index].m(target, anchor);
  			insert(target, if_block_anchor, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			if_block.p(ctx, dirty);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(if_block);
  			current = true;
  		},
  		o(local) {
  			transition_out(if_block);
  			current = false;
  		},
  		d(detaching) {
  			if_blocks[current_block_type_index].d(detaching);
  			if (detaching) detach(if_block_anchor);
  		}
  	};
  }

  function instance$q($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component, ["MDCList:action"]);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { nonInteractive = false } = $$props;
  	let { dense = false } = $$props;
  	let { avatarList = false } = $$props;
  	let { twoLine = false } = $$props;
  	let { threeLine = false } = $$props;
  	let { vertical = true } = $$props;
  	let { wrapFocus = false } = $$props;
  	let { singleSelection = false } = $$props;
  	let { selectedIndex = null } = $$props;
  	let { radiolist = false } = $$props;
  	let { checklist = false } = $$props;
  	let element;
  	let list;
  	let role = getContext("SMUI:list:role");
  	let nav = getContext("SMUI:list:nav");
  	let instantiate = getContext("SMUI:list:instantiate");
  	let getInstance = getContext("SMUI:list:getInstance");
  	let addLayoutListener = getContext("SMUI:addLayoutListener");
  	let removeLayoutListener;
  	setContext("SMUI:list:nonInteractive", nonInteractive);

  	if (!role) {
  		if (singleSelection) {
  			role = "listbox";
  			setContext("SMUI:list:item:role", "option");
  		} else if (radiolist) {
  			role = "radiogroup";
  			setContext("SMUI:list:item:role", "radio");
  		} else if (checklist) {
  			role = "group";
  			setContext("SMUI:list:item:role", "checkbox");
  		} else {
  			role = "list";
  			setContext("SMUI:list:item:role", undefined);
  		}
  	}

  	if (addLayoutListener) {
  		removeLayoutListener = addLayoutListener(layout);
  	}

  	onMount(async () => {
  		if (instantiate !== false) {
  			$$invalidate(22, list = new MDCList(element));
  		} else {
  			$$invalidate(22, list = await getInstance());
  		}

  		if (singleSelection) {
  			list.initializeListType();
  			$$invalidate(13, selectedIndex = list.selectedIndex);
  		}
  	});

  	onDestroy(() => {
  		if (instantiate !== false) {
  			list && list.destroy();
  		}

  		if (removeLayoutListener) {
  			removeLayoutListener();
  		}
  	});

  	function handleAction(e) {
  		if (list && list.listElements[e.detail.index].classList.contains("mdc-list-item--disabled")) {
  			e.preventDefault();
  			$$invalidate(22, list.selectedIndex = selectedIndex, list);
  		} else if (list && list.selectedIndex === e.detail.index) {
  			$$invalidate(13, selectedIndex = e.detail.index);
  		}
  	}

  	function layout(...args) {
  		return list.layout(...args);
  	}

  	function setEnabled(...args) {
  		return list.setEnabled(...args);
  	}

  	function getDefaultFoundation(...args) {
  		return list.getDefaultFoundation(...args);
  	}

  	let { $$slots = {}, $$scope } = $$props;

  	function nav_1_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(7, element = $$value);
  		});
  	}

  	function ul_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(7, element = $$value);
  		});
  	}

  	$$self.$set = $$new_props => {
  		$$invalidate(27, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("nonInteractive" in $$new_props) $$invalidate(2, nonInteractive = $$new_props.nonInteractive);
  		if ("dense" in $$new_props) $$invalidate(3, dense = $$new_props.dense);
  		if ("avatarList" in $$new_props) $$invalidate(4, avatarList = $$new_props.avatarList);
  		if ("twoLine" in $$new_props) $$invalidate(5, twoLine = $$new_props.twoLine);
  		if ("threeLine" in $$new_props) $$invalidate(6, threeLine = $$new_props.threeLine);
  		if ("vertical" in $$new_props) $$invalidate(14, vertical = $$new_props.vertical);
  		if ("wrapFocus" in $$new_props) $$invalidate(15, wrapFocus = $$new_props.wrapFocus);
  		if ("singleSelection" in $$new_props) $$invalidate(16, singleSelection = $$new_props.singleSelection);
  		if ("selectedIndex" in $$new_props) $$invalidate(13, selectedIndex = $$new_props.selectedIndex);
  		if ("radiolist" in $$new_props) $$invalidate(17, radiolist = $$new_props.radiolist);
  		if ("checklist" in $$new_props) $$invalidate(18, checklist = $$new_props.checklist);
  		if ("$$scope" in $$new_props) $$invalidate(28, $$scope = $$new_props.$$scope);
  	};

  	let props;

  	$$self.$$.update = () => {
  		 $$invalidate(9, props = exclude($$props, [
  			"use",
  			"class",
  			"nonInteractive",
  			"dense",
  			"avatarList",
  			"twoLine",
  			"threeLine",
  			"vertical",
  			"wrapFocus",
  			"singleSelection",
  			"selectedIndex",
  			"radiolist",
  			"checklist"
  		]));

  		if ($$self.$$.dirty[0] & /*list, vertical*/ 4210688) {
  			 if (list && list.vertical !== vertical) {
  				$$invalidate(22, list.vertical = vertical, list);
  			}
  		}

  		if ($$self.$$.dirty[0] & /*list, wrapFocus*/ 4227072) {
  			 if (list && list.wrapFocus !== wrapFocus) {
  				$$invalidate(22, list.wrapFocus = wrapFocus, list);
  			}
  		}

  		if ($$self.$$.dirty[0] & /*list, singleSelection*/ 4259840) {
  			 if (list && list.singleSelection !== singleSelection) {
  				$$invalidate(22, list.singleSelection = singleSelection, list);
  			}
  		}

  		if ($$self.$$.dirty[0] & /*list, singleSelection, selectedIndex*/ 4268032) {
  			 if (list && singleSelection && list.selectedIndex !== selectedIndex) {
  				$$invalidate(22, list.selectedIndex = selectedIndex, list);
  			}
  		}
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		nonInteractive,
  		dense,
  		avatarList,
  		twoLine,
  		threeLine,
  		element,
  		role,
  		props,
  		forwardEvents,
  		nav,
  		handleAction,
  		selectedIndex,
  		vertical,
  		wrapFocus,
  		singleSelection,
  		radiolist,
  		checklist,
  		layout,
  		setEnabled,
  		getDefaultFoundation,
  		list,
  		removeLayoutListener,
  		instantiate,
  		getInstance,
  		addLayoutListener,
  		$$props,
  		$$scope,
  		$$slots,
  		nav_1_binding,
  		ul_binding
  	];
  }

  class List extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(
  			this,
  			options,
  			instance$q,
  			create_fragment$r,
  			safe_not_equal,
  			{
  				use: 0,
  				class: 1,
  				nonInteractive: 2,
  				dense: 3,
  				avatarList: 4,
  				twoLine: 5,
  				threeLine: 6,
  				vertical: 14,
  				wrapFocus: 15,
  				singleSelection: 16,
  				selectedIndex: 13,
  				radiolist: 17,
  				checklist: 18,
  				layout: 19,
  				setEnabled: 20,
  				getDefaultFoundation: 21
  			},
  			[-1, -1]
  		);
  	}

  	get layout() {
  		return this.$$.ctx[19];
  	}

  	get setEnabled() {
  		return this.$$.ctx[20];
  	}

  	get getDefaultFoundation() {
  		return this.$$.ctx[21];
  	}
  }

  /* node_modules\@smui\list\Item.svelte generated by Svelte v3.18.1 */

  function create_else_block$5(ctx) {
  	let li;
  	let useActions_action;
  	let forwardEvents_action;
  	let Ripple_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[25].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[24], null);

  	let li_levels = [
  		/*role*/ ctx[6] === "option"
  		? {
  				"aria-selected": /*selected*/ ctx[7] ? "true" : "false"
  			}
  		: {},
  		/*props*/ ctx[12],
  		{
  			class: "\n      mdc-list-item\n      " + /*className*/ ctx[2] + "\n      " + (/*activated*/ ctx[5] ? "mdc-list-item--activated" : "") + "\n      " + (/*selected*/ ctx[7] ? "mdc-list-item--selected" : "") + "\n      " + (/*disabled*/ ctx[8] ? "mdc-list-item--disabled" : "") + "\n      " + (/*role*/ ctx[6] === "menuitem" && /*selected*/ ctx[7]
  			? "mdc-menu-item--selected"
  			: "") + "\n    "
  		},
  		{ role: /*role*/ ctx[6] },
  		/*role*/ ctx[6] === "radio" || /*role*/ ctx[6] === "checkbox"
  		? {
  				"aria-checked": /*checked*/ ctx[10] ? "true" : "false"
  			}
  		: {},
  		{ tabindex: /*tabindex*/ ctx[0] }
  	];

  	let li_data = {};

  	for (let i = 0; i < li_levels.length; i += 1) {
  		li_data = assign(li_data, li_levels[i]);
  	}

  	return {
  		c() {
  			li = element("li");
  			if (default_slot) default_slot.c();
  			set_attributes(li, li_data);
  		},
  		m(target, anchor) {
  			insert(target, li, anchor);

  			if (default_slot) {
  				default_slot.m(li, null);
  			}

  			/*li_binding*/ ctx[28](li);
  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, li, /*use*/ ctx[1])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[13].call(null, li)),
  				action_destroyer(Ripple_action = Ripple.call(null, li, {
  					ripple: /*ripple*/ ctx[3],
  					unbounded: false,
  					color: /*color*/ ctx[4]
  				})),
  				listen(li, "click", /*action*/ ctx[15]),
  				listen(li, "keydown", /*handleKeydown*/ ctx[16])
  			];
  		},
  		p(ctx, dirty) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 16777216) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[24], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[24], dirty, null));
  			}

  			set_attributes(li, get_spread_update(li_levels, [
  				dirty & /*role, selected*/ 192 && (/*role*/ ctx[6] === "option"
  				? {
  						"aria-selected": /*selected*/ ctx[7] ? "true" : "false"
  					}
  				: {}),
  				dirty & /*props*/ 4096 && /*props*/ ctx[12],
  				dirty & /*className, activated, selected, disabled, role*/ 484 && {
  					class: "\n      mdc-list-item\n      " + /*className*/ ctx[2] + "\n      " + (/*activated*/ ctx[5] ? "mdc-list-item--activated" : "") + "\n      " + (/*selected*/ ctx[7] ? "mdc-list-item--selected" : "") + "\n      " + (/*disabled*/ ctx[8] ? "mdc-list-item--disabled" : "") + "\n      " + (/*role*/ ctx[6] === "menuitem" && /*selected*/ ctx[7]
  					? "mdc-menu-item--selected"
  					: "") + "\n    "
  				},
  				dirty & /*role*/ 64 && { role: /*role*/ ctx[6] },
  				dirty & /*role, checked*/ 1088 && (/*role*/ ctx[6] === "radio" || /*role*/ ctx[6] === "checkbox"
  				? {
  						"aria-checked": /*checked*/ ctx[10] ? "true" : "false"
  					}
  				: {}),
  				dirty & /*tabindex*/ 1 && { tabindex: /*tabindex*/ ctx[0] }
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 2) useActions_action.update.call(null, /*use*/ ctx[1]);

  			if (Ripple_action && is_function(Ripple_action.update) && dirty & /*ripple, color*/ 24) Ripple_action.update.call(null, {
  				ripple: /*ripple*/ ctx[3],
  				unbounded: false,
  				color: /*color*/ ctx[4]
  			});
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
  			if (detaching) detach(li);
  			if (default_slot) default_slot.d(detaching);
  			/*li_binding*/ ctx[28](null);
  			run_all(dispose);
  		}
  	};
  }

  // (21:23) 
  function create_if_block_1$3(ctx) {
  	let span;
  	let useActions_action;
  	let forwardEvents_action;
  	let Ripple_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[25].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[24], null);

  	let span_levels = [
  		{
  			class: "\n      mdc-list-item\n      " + /*className*/ ctx[2] + "\n      " + (/*activated*/ ctx[5] ? "mdc-list-item--activated" : "") + "\n      " + (/*selected*/ ctx[7] ? "mdc-list-item--selected" : "") + "\n      " + (/*disabled*/ ctx[8] ? "mdc-list-item--disabled" : "") + "\n    "
  		},
  		/*activated*/ ctx[5] ? { "aria-current": "page" } : {},
  		{ tabindex: /*tabindex*/ ctx[0] },
  		/*props*/ ctx[12]
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

  			/*span_binding*/ ctx[27](span);
  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, span, /*use*/ ctx[1])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[13].call(null, span)),
  				action_destroyer(Ripple_action = Ripple.call(null, span, {
  					ripple: /*ripple*/ ctx[3],
  					unbounded: false,
  					color: /*color*/ ctx[4]
  				})),
  				listen(span, "click", /*action*/ ctx[15]),
  				listen(span, "keydown", /*handleKeydown*/ ctx[16])
  			];
  		},
  		p(ctx, dirty) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 16777216) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[24], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[24], dirty, null));
  			}

  			set_attributes(span, get_spread_update(span_levels, [
  				dirty & /*className, activated, selected, disabled*/ 420 && {
  					class: "\n      mdc-list-item\n      " + /*className*/ ctx[2] + "\n      " + (/*activated*/ ctx[5] ? "mdc-list-item--activated" : "") + "\n      " + (/*selected*/ ctx[7] ? "mdc-list-item--selected" : "") + "\n      " + (/*disabled*/ ctx[8] ? "mdc-list-item--disabled" : "") + "\n    "
  				},
  				dirty & /*activated*/ 32 && (/*activated*/ ctx[5] ? { "aria-current": "page" } : {}),
  				dirty & /*tabindex*/ 1 && { tabindex: /*tabindex*/ ctx[0] },
  				dirty & /*props*/ 4096 && /*props*/ ctx[12]
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 2) useActions_action.update.call(null, /*use*/ ctx[1]);

  			if (Ripple_action && is_function(Ripple_action.update) && dirty & /*ripple, color*/ 24) Ripple_action.update.call(null, {
  				ripple: /*ripple*/ ctx[3],
  				unbounded: false,
  				color: /*color*/ ctx[4]
  			});
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
  			/*span_binding*/ ctx[27](null);
  			run_all(dispose);
  		}
  	};
  }

  // (1:0) {#if nav && href}
  function create_if_block$7(ctx) {
  	let a;
  	let useActions_action;
  	let forwardEvents_action;
  	let Ripple_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[25].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[24], null);

  	let a_levels = [
  		{ href: /*href*/ ctx[9] },
  		/*props*/ ctx[12],
  		{
  			class: "\n      mdc-list-item\n      " + /*className*/ ctx[2] + "\n      " + (/*activated*/ ctx[5] ? "mdc-list-item--activated" : "") + "\n      " + (/*selected*/ ctx[7] ? "mdc-list-item--selected" : "") + "\n      " + (/*disabled*/ ctx[8] ? "mdc-list-item--disabled" : "") + "\n    "
  		},
  		/*activated*/ ctx[5] ? { "aria-current": "page" } : {},
  		{ tabindex: /*tabindex*/ ctx[0] }
  	];

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

  			/*a_binding*/ ctx[26](a);
  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, a, /*use*/ ctx[1])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[13].call(null, a)),
  				action_destroyer(Ripple_action = Ripple.call(null, a, {
  					ripple: /*ripple*/ ctx[3],
  					unbounded: false,
  					color: /*color*/ ctx[4]
  				})),
  				listen(a, "click", /*action*/ ctx[15]),
  				listen(a, "keydown", /*handleKeydown*/ ctx[16])
  			];
  		},
  		p(ctx, dirty) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 16777216) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[24], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[24], dirty, null));
  			}

  			set_attributes(a, get_spread_update(a_levels, [
  				dirty & /*href*/ 512 && { href: /*href*/ ctx[9] },
  				dirty & /*props*/ 4096 && /*props*/ ctx[12],
  				dirty & /*className, activated, selected, disabled*/ 420 && {
  					class: "\n      mdc-list-item\n      " + /*className*/ ctx[2] + "\n      " + (/*activated*/ ctx[5] ? "mdc-list-item--activated" : "") + "\n      " + (/*selected*/ ctx[7] ? "mdc-list-item--selected" : "") + "\n      " + (/*disabled*/ ctx[8] ? "mdc-list-item--disabled" : "") + "\n    "
  				},
  				dirty & /*activated*/ 32 && (/*activated*/ ctx[5] ? { "aria-current": "page" } : {}),
  				dirty & /*tabindex*/ 1 && { tabindex: /*tabindex*/ ctx[0] }
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 2) useActions_action.update.call(null, /*use*/ ctx[1]);

  			if (Ripple_action && is_function(Ripple_action.update) && dirty & /*ripple, color*/ 24) Ripple_action.update.call(null, {
  				ripple: /*ripple*/ ctx[3],
  				unbounded: false,
  				color: /*color*/ ctx[4]
  			});
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
  			/*a_binding*/ ctx[26](null);
  			run_all(dispose);
  		}
  	};
  }

  function create_fragment$s(ctx) {
  	let current_block_type_index;
  	let if_block;
  	let if_block_anchor;
  	let current;
  	const if_block_creators = [create_if_block$7, create_if_block_1$3, create_else_block$5];
  	const if_blocks = [];

  	function select_block_type(ctx, dirty) {
  		if (/*nav*/ ctx[14] && /*href*/ ctx[9]) return 0;
  		if (/*nav*/ ctx[14] && !/*href*/ ctx[9]) return 1;
  		return 2;
  	}

  	current_block_type_index = select_block_type(ctx);
  	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

  	return {
  		c() {
  			if_block.c();
  			if_block_anchor = empty();
  		},
  		m(target, anchor) {
  			if_blocks[current_block_type_index].m(target, anchor);
  			insert(target, if_block_anchor, anchor);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			let previous_block_index = current_block_type_index;
  			current_block_type_index = select_block_type(ctx);

  			if (current_block_type_index === previous_block_index) {
  				if_blocks[current_block_type_index].p(ctx, dirty);
  			} else {
  				group_outros();

  				transition_out(if_blocks[previous_block_index], 1, 1, () => {
  					if_blocks[previous_block_index] = null;
  				});

  				check_outros();
  				if_block = if_blocks[current_block_type_index];

  				if (!if_block) {
  					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
  					if_block.c();
  				}

  				transition_in(if_block, 1);
  				if_block.m(if_block_anchor.parentNode, if_block_anchor);
  			}
  		},
  		i(local) {
  			if (current) return;
  			transition_in(if_block);
  			current = true;
  		},
  		o(local) {
  			transition_out(if_block);
  			current = false;
  		},
  		d(detaching) {
  			if_blocks[current_block_type_index].d(detaching);
  			if (detaching) detach(if_block_anchor);
  		}
  	};
  }

  let counter$1 = 0;

  function instance$r($$self, $$props, $$invalidate) {
  	const dispatch = createEventDispatcher();
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let checked = false;
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { ripple = true } = $$props;
  	let { color = null } = $$props;
  	let { nonInteractive = getContext("SMUI:list:nonInteractive") } = $$props;
  	let { activated = false } = $$props;
  	let { role = getContext("SMUI:list:item:role") } = $$props;
  	let { selected = false } = $$props;
  	let { disabled = false } = $$props;
  	let { tabindex = !nonInteractive && !disabled && (selected || checked) && "0" || "-1" } = $$props;
  	let { href = false } = $$props;
  	let { inputId = "SMUI-form-field-list-" + counter$1++ } = $$props;
  	let element;
  	let addTabindexIfNoItemsSelectedRaf;
  	let nav = getContext("SMUI:list:item:nav");
  	setContext("SMUI:generic:input:props", { id: inputId });
  	setContext("SMUI:generic:input:setChecked", setChecked);

  	onMount(() => {
  		// Tabindex needs to be '0' if this is the first non-disabled list item, and
  		// no other item is selected.
  		if (!selected && !nonInteractive) {
  			let first = true;
  			let el = element;

  			while (el.previousSibling) {
  				el = el.previousSibling;

  				if (el.nodeType === 1 && el.classList.contains("mdc-list-item") && !el.classList.contains("mdc-list-item--disabled")) {
  					first = false;
  					break;
  				}
  			}

  			if (first) {
  				// This is first, so now set up a check that no other items are
  				// selected.
  				addTabindexIfNoItemsSelectedRaf = window.requestAnimationFrame(addTabindexIfNoItemsSelected);
  			}
  		}
  	});

  	onDestroy(() => {
  		if (addTabindexIfNoItemsSelectedRaf) {
  			window.cancelAnimationFrame(addTabindexIfNoItemsSelectedRaf);
  		}
  	});

  	function addTabindexIfNoItemsSelected() {
  		// Look through next siblings to see if none of them are selected.
  		let noneSelected = true;

  		let el = element;

  		while (el.nextSibling) {
  			el = el.nextSibling;

  			if (el.nodeType === 1 && el.classList.contains("mdc-list-item") && el.attributes["tabindex"] && el.attributes["tabindex"].value === "0") {
  				noneSelected = false;
  				break;
  			}
  		}

  		if (noneSelected) {
  			// This is the first element, and no other element is selected, so the
  			// tabindex should be '0'.
  			$$invalidate(0, tabindex = "0");
  		}
  	}

  	function action(e) {
  		if (disabled) {
  			e.preventDefault();
  		} else {
  			dispatch("SMUI:action", e);
  		}
  	}

  	function handleKeydown(e) {
  		const isEnter = e.key === "Enter" || e.keyCode === 13;
  		const isSpace = e.key === "Space" || e.keyCode === 32;

  		if (isEnter || isSpace) {
  			action(e);
  		}
  	}

  	function setChecked(isChecked) {
  		$$invalidate(10, checked = isChecked);
  		$$invalidate(0, tabindex = !nonInteractive && !disabled && (selected || checked) && "0" || "-1");
  	}

  	let { $$slots = {}, $$scope } = $$props;

  	function a_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(11, element = $$value);
  		});
  	}

  	function span_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(11, element = $$value);
  		});
  	}

  	function li_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(11, element = $$value);
  		});
  	}

  	$$self.$set = $$new_props => {
  		$$invalidate(23, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(1, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(2, className = $$new_props.class);
  		if ("ripple" in $$new_props) $$invalidate(3, ripple = $$new_props.ripple);
  		if ("color" in $$new_props) $$invalidate(4, color = $$new_props.color);
  		if ("nonInteractive" in $$new_props) $$invalidate(17, nonInteractive = $$new_props.nonInteractive);
  		if ("activated" in $$new_props) $$invalidate(5, activated = $$new_props.activated);
  		if ("role" in $$new_props) $$invalidate(6, role = $$new_props.role);
  		if ("selected" in $$new_props) $$invalidate(7, selected = $$new_props.selected);
  		if ("disabled" in $$new_props) $$invalidate(8, disabled = $$new_props.disabled);
  		if ("tabindex" in $$new_props) $$invalidate(0, tabindex = $$new_props.tabindex);
  		if ("href" in $$new_props) $$invalidate(9, href = $$new_props.href);
  		if ("inputId" in $$new_props) $$invalidate(18, inputId = $$new_props.inputId);
  		if ("$$scope" in $$new_props) $$invalidate(24, $$scope = $$new_props.$$scope);
  	};

  	let props;

  	$$self.$$.update = () => {
  		 $$invalidate(12, props = exclude($$props, [
  			"use",
  			"class",
  			"ripple",
  			"color",
  			"nonInteractive",
  			"activated",
  			"selected",
  			"disabled",
  			"tabindex",
  			"href",
  			"inputId"
  		]));
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		tabindex,
  		use,
  		className,
  		ripple,
  		color,
  		activated,
  		role,
  		selected,
  		disabled,
  		href,
  		checked,
  		element,
  		props,
  		forwardEvents,
  		nav,
  		action,
  		handleKeydown,
  		nonInteractive,
  		inputId,
  		addTabindexIfNoItemsSelectedRaf,
  		dispatch,
  		addTabindexIfNoItemsSelected,
  		setChecked,
  		$$props,
  		$$scope,
  		$$slots,
  		a_binding,
  		span_binding,
  		li_binding
  	];
  }

  class Item extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$r, create_fragment$s, safe_not_equal, {
  			use: 1,
  			class: 2,
  			ripple: 3,
  			color: 4,
  			nonInteractive: 17,
  			activated: 5,
  			role: 6,
  			selected: 7,
  			disabled: 8,
  			tabindex: 0,
  			href: 9,
  			inputId: 18
  		});
  	}
  }

  /* node_modules\@smui\common\Span.svelte generated by Svelte v3.18.1 */

  function create_fragment$t(ctx) {
  	let span;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[4].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[3], null);
  	let span_levels = [exclude(/*$$props*/ ctx[2], ["use"])];
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
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[1].call(null, span))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 8) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[3], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[3], dirty, null));
  			}

  			set_attributes(span, get_spread_update(span_levels, [dirty & /*exclude, $$props*/ 4 && exclude(/*$$props*/ ctx[2], ["use"])]));
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

  function instance$s($$self, $$props, $$invalidate) {
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

  class Span extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$s, create_fragment$t, safe_not_equal, { use: 0 });
  	}
  }

  classAdderBuilder({
    class: 'mdc-list-item__text',
    component: Span,
    contexts: {}
  });

  classAdderBuilder({
    class: 'mdc-list-item__primary-text',
    component: Span,
    contexts: {}
  });

  classAdderBuilder({
    class: 'mdc-list-item__secondary-text',
    component: Span,
    contexts: {}
  });

  classAdderBuilder({
    class: 'mdc-list-item__graphic',
    component: Span,
    contexts: {}
  });

  classAdderBuilder({
    class: 'mdc-list-item__meta',
    component: Span,
    contexts: {}
  });

  classAdderBuilder({
    class: 'mdc-list-group',
    component: Div,
    contexts: {}
  });

  /* node_modules\@smui\common\H3.svelte generated by Svelte v3.18.1 */

  function create_fragment$u(ctx) {
  	let h3;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[4].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[3], null);
  	let h3_levels = [exclude(/*$$props*/ ctx[2], ["use"])];
  	let h3_data = {};

  	for (let i = 0; i < h3_levels.length; i += 1) {
  		h3_data = assign(h3_data, h3_levels[i]);
  	}

  	return {
  		c() {
  			h3 = element("h3");
  			if (default_slot) default_slot.c();
  			set_attributes(h3, h3_data);
  		},
  		m(target, anchor) {
  			insert(target, h3, anchor);

  			if (default_slot) {
  				default_slot.m(h3, null);
  			}

  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, h3, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[1].call(null, h3))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 8) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[3], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[3], dirty, null));
  			}

  			set_attributes(h3, get_spread_update(h3_levels, [dirty & /*exclude, $$props*/ 4 && exclude(/*$$props*/ ctx[2], ["use"])]));
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
  			if (detaching) detach(h3);
  			if (default_slot) default_slot.d(detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance$t($$self, $$props, $$invalidate) {
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

  class H3 extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$t, create_fragment$u, safe_not_equal, { use: 0 });
  	}
  }

  classAdderBuilder({
    class: 'mdc-list-group__subheader',
    component: H3,
    contexts: {}
  });

  /* node_modules\@smui\list\Separator.svelte generated by Svelte v3.18.1 */

  function create_else_block$6(ctx) {
  	let li;
  	let useActions_action;
  	let forwardEvents_action;
  	let dispose;

  	let li_levels = [
  		{
  			class: "\n      mdc-list-divider\n      " + /*className*/ ctx[1] + "\n      " + (/*padded*/ ctx[4] ? "mdc-list-divider--padded" : "") + "\n      " + (/*inset*/ ctx[5] ? "mdc-list-divider--inset" : "") + "\n    "
  		},
  		{ role: "separator" },
  		/*props*/ ctx[6]
  	];

  	let li_data = {};

  	for (let i = 0; i < li_levels.length; i += 1) {
  		li_data = assign(li_data, li_levels[i]);
  	}

  	return {
  		c() {
  			li = element("li");
  			set_attributes(li, li_data);
  		},
  		m(target, anchor) {
  			insert(target, li, anchor);

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, li, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[7].call(null, li))
  			];
  		},
  		p(ctx, dirty) {
  			set_attributes(li, get_spread_update(li_levels, [
  				dirty & /*className, padded, inset*/ 50 && {
  					class: "\n      mdc-list-divider\n      " + /*className*/ ctx[1] + "\n      " + (/*padded*/ ctx[4] ? "mdc-list-divider--padded" : "") + "\n      " + (/*inset*/ ctx[5] ? "mdc-list-divider--inset" : "") + "\n    "
  				},
  				{ role: "separator" },
  				dirty & /*props*/ 64 && /*props*/ ctx[6]
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		d(detaching) {
  			if (detaching) detach(li);
  			run_all(dispose);
  		}
  	};
  }

  // (1:0) {#if group || nav}
  function create_if_block$8(ctx) {
  	let hr;
  	let useActions_action;
  	let forwardEvents_action;
  	let dispose;

  	let hr_levels = [
  		{
  			class: "\n      mdc-list-divider\n      " + /*className*/ ctx[1] + "\n      " + (/*padded*/ ctx[4] ? "mdc-list-divider--padded" : "") + "\n      " + (/*inset*/ ctx[5] ? "mdc-list-divider--inset" : "") + "\n    "
  		},
  		/*props*/ ctx[6]
  	];

  	let hr_data = {};

  	for (let i = 0; i < hr_levels.length; i += 1) {
  		hr_data = assign(hr_data, hr_levels[i]);
  	}

  	return {
  		c() {
  			hr = element("hr");
  			set_attributes(hr, hr_data);
  		},
  		m(target, anchor) {
  			insert(target, hr, anchor);

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, hr, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[7].call(null, hr))
  			];
  		},
  		p(ctx, dirty) {
  			set_attributes(hr, get_spread_update(hr_levels, [
  				dirty & /*className, padded, inset*/ 50 && {
  					class: "\n      mdc-list-divider\n      " + /*className*/ ctx[1] + "\n      " + (/*padded*/ ctx[4] ? "mdc-list-divider--padded" : "") + "\n      " + (/*inset*/ ctx[5] ? "mdc-list-divider--inset" : "") + "\n    "
  				},
  				dirty & /*props*/ 64 && /*props*/ ctx[6]
  			]));

  			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 1) useActions_action.update.call(null, /*use*/ ctx[0]);
  		},
  		d(detaching) {
  			if (detaching) detach(hr);
  			run_all(dispose);
  		}
  	};
  }

  function create_fragment$v(ctx) {
  	let if_block_anchor;

  	function select_block_type(ctx, dirty) {
  		if (/*group*/ ctx[2] || /*nav*/ ctx[3]) return create_if_block$8;
  		return create_else_block$6;
  	}

  	let current_block_type = select_block_type(ctx);
  	let if_block = current_block_type(ctx);

  	return {
  		c() {
  			if_block.c();
  			if_block_anchor = empty();
  		},
  		m(target, anchor) {
  			if_block.m(target, anchor);
  			insert(target, if_block_anchor, anchor);
  		},
  		p(ctx, [dirty]) {
  			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
  				if_block.p(ctx, dirty);
  			} else {
  				if_block.d(1);
  				if_block = current_block_type(ctx);

  				if (if_block) {
  					if_block.c();
  					if_block.m(if_block_anchor.parentNode, if_block_anchor);
  				}
  			}
  		},
  		i: noop,
  		o: noop,
  		d(detaching) {
  			if_block.d(detaching);
  			if (detaching) detach(if_block_anchor);
  		}
  	};
  }

  function instance$u($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { group = false } = $$props;
  	let { nav = false } = $$props;
  	let { padded = false } = $$props;
  	let { inset = false } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(8, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("group" in $$new_props) $$invalidate(2, group = $$new_props.group);
  		if ("nav" in $$new_props) $$invalidate(3, nav = $$new_props.nav);
  		if ("padded" in $$new_props) $$invalidate(4, padded = $$new_props.padded);
  		if ("inset" in $$new_props) $$invalidate(5, inset = $$new_props.inset);
  	};

  	let props;

  	$$self.$$.update = () => {
  		 $$invalidate(6, props = exclude($$props, ["use", "class", "group", "nav", "padded", "inset"]));
  	};

  	$$props = exclude_internal_props($$props);
  	return [use, className, group, nav, padded, inset, props, forwardEvents];
  }

  class Separator extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$u, create_fragment$v, safe_not_equal, {
  			use: 0,
  			class: 1,
  			group: 2,
  			nav: 3,
  			padded: 4,
  			inset: 5
  		});
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
  var cssClasses$d = {
      FIXED_CLASS: 'mdc-top-app-bar--fixed',
      FIXED_SCROLLED_CLASS: 'mdc-top-app-bar--fixed-scrolled',
      SHORT_CLASS: 'mdc-top-app-bar--short',
      SHORT_COLLAPSED_CLASS: 'mdc-top-app-bar--short-collapsed',
      SHORT_HAS_ACTION_ITEM_CLASS: 'mdc-top-app-bar--short-has-action-item',
  };
  var numbers$4 = {
      DEBOUNCE_THROTTLE_RESIZE_TIME_MS: 100,
      MAX_TOP_APP_BAR_HEIGHT: 128,
  };
  var strings$b = {
      ACTION_ITEM_SELECTOR: '.mdc-top-app-bar__action-item',
      NAVIGATION_EVENT: 'MDCTopAppBar:nav',
      NAVIGATION_ICON_SELECTOR: '.mdc-top-app-bar__navigation-icon',
      ROOT_SELECTOR: '.mdc-top-app-bar',
      TITLE_SELECTOR: '.mdc-top-app-bar__title',
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
  var MDCTopAppBarBaseFoundation = /** @class */ (function (_super) {
      __extends(MDCTopAppBarBaseFoundation, _super);
      /* istanbul ignore next: optional argument is not a branch statement */
      function MDCTopAppBarBaseFoundation(adapter) {
          return _super.call(this, __assign({}, MDCTopAppBarBaseFoundation.defaultAdapter, adapter)) || this;
      }
      Object.defineProperty(MDCTopAppBarBaseFoundation, "strings", {
          get: function () {
              return strings$b;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTopAppBarBaseFoundation, "cssClasses", {
          get: function () {
              return cssClasses$d;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTopAppBarBaseFoundation, "numbers", {
          get: function () {
              return numbers$4;
          },
          enumerable: true,
          configurable: true
      });
      Object.defineProperty(MDCTopAppBarBaseFoundation, "defaultAdapter", {
          /**
           * See {@link MDCTopAppBarAdapter} for typing information on parameters and return types.
           */
          get: function () {
              // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
              return {
                  addClass: function () { return undefined; },
                  removeClass: function () { return undefined; },
                  hasClass: function () { return false; },
                  setStyle: function () { return undefined; },
                  getTopAppBarHeight: function () { return 0; },
                  notifyNavigationIconClicked: function () { return undefined; },
                  getViewportScrollY: function () { return 0; },
                  getTotalActionItems: function () { return 0; },
              };
              // tslint:enable:object-literal-sort-keys
          },
          enumerable: true,
          configurable: true
      });
      /** Other variants of TopAppBar foundation overrides this method */
      MDCTopAppBarBaseFoundation.prototype.handleTargetScroll = function () { }; // tslint:disable-line:no-empty
      /** Other variants of TopAppBar foundation overrides this method */
      MDCTopAppBarBaseFoundation.prototype.handleWindowResize = function () { }; // tslint:disable-line:no-empty
      MDCTopAppBarBaseFoundation.prototype.handleNavigationClick = function () {
          this.adapter_.notifyNavigationIconClicked();
      };
      return MDCTopAppBarBaseFoundation;
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
  var INITIAL_VALUE = 0;
  var MDCTopAppBarFoundation = /** @class */ (function (_super) {
      __extends(MDCTopAppBarFoundation, _super);
      /* istanbul ignore next: optional argument is not a branch statement */
      function MDCTopAppBarFoundation(adapter) {
          var _this = _super.call(this, adapter) || this;
          /**
           * Indicates if the top app bar was docked in the previous scroll handler iteration.
           */
          _this.wasDocked_ = true;
          /**
           * Indicates if the top app bar is docked in the fully shown position.
           */
          _this.isDockedShowing_ = true;
          /**
           * Variable for current scroll position of the top app bar
           */
          _this.currentAppBarOffsetTop_ = 0;
          /**
           * Used to prevent the top app bar from being scrolled out of view during resize events
           */
          _this.isCurrentlyBeingResized_ = false;
          /**
           * The timeout that's used to throttle the resize events
           */
          _this.resizeThrottleId_ = INITIAL_VALUE;
          /**
           * The timeout that's used to debounce toggling the isCurrentlyBeingResized_ variable after a resize
           */
          _this.resizeDebounceId_ = INITIAL_VALUE;
          _this.lastScrollPosition_ = _this.adapter_.getViewportScrollY();
          _this.topAppBarHeight_ = _this.adapter_.getTopAppBarHeight();
          return _this;
      }
      MDCTopAppBarFoundation.prototype.destroy = function () {
          _super.prototype.destroy.call(this);
          this.adapter_.setStyle('top', '');
      };
      /**
       * Scroll handler for the default scroll behavior of the top app bar.
       * @override
       */
      MDCTopAppBarFoundation.prototype.handleTargetScroll = function () {
          var currentScrollPosition = Math.max(this.adapter_.getViewportScrollY(), 0);
          var diff = currentScrollPosition - this.lastScrollPosition_;
          this.lastScrollPosition_ = currentScrollPosition;
          // If the window is being resized the lastScrollPosition_ needs to be updated but the
          // current scroll of the top app bar should stay in the same position.
          if (!this.isCurrentlyBeingResized_) {
              this.currentAppBarOffsetTop_ -= diff;
              if (this.currentAppBarOffsetTop_ > 0) {
                  this.currentAppBarOffsetTop_ = 0;
              }
              else if (Math.abs(this.currentAppBarOffsetTop_) > this.topAppBarHeight_) {
                  this.currentAppBarOffsetTop_ = -this.topAppBarHeight_;
              }
              this.moveTopAppBar_();
          }
      };
      /**
       * Top app bar resize handler that throttle/debounce functions that execute updates.
       * @override
       */
      MDCTopAppBarFoundation.prototype.handleWindowResize = function () {
          var _this = this;
          // Throttle resize events 10 p/s
          if (!this.resizeThrottleId_) {
              this.resizeThrottleId_ = setTimeout(function () {
                  _this.resizeThrottleId_ = INITIAL_VALUE;
                  _this.throttledResizeHandler_();
              }, numbers$4.DEBOUNCE_THROTTLE_RESIZE_TIME_MS);
          }
          this.isCurrentlyBeingResized_ = true;
          if (this.resizeDebounceId_) {
              clearTimeout(this.resizeDebounceId_);
          }
          this.resizeDebounceId_ = setTimeout(function () {
              _this.handleTargetScroll();
              _this.isCurrentlyBeingResized_ = false;
              _this.resizeDebounceId_ = INITIAL_VALUE;
          }, numbers$4.DEBOUNCE_THROTTLE_RESIZE_TIME_MS);
      };
      /**
       * Function to determine if the DOM needs to update.
       */
      MDCTopAppBarFoundation.prototype.checkForUpdate_ = function () {
          var offscreenBoundaryTop = -this.topAppBarHeight_;
          var hasAnyPixelsOffscreen = this.currentAppBarOffsetTop_ < 0;
          var hasAnyPixelsOnscreen = this.currentAppBarOffsetTop_ > offscreenBoundaryTop;
          var partiallyShowing = hasAnyPixelsOffscreen && hasAnyPixelsOnscreen;
          // If it's partially showing, it can't be docked.
          if (partiallyShowing) {
              this.wasDocked_ = false;
          }
          else {
              // Not previously docked and not partially showing, it's now docked.
              if (!this.wasDocked_) {
                  this.wasDocked_ = true;
                  return true;
              }
              else if (this.isDockedShowing_ !== hasAnyPixelsOnscreen) {
                  this.isDockedShowing_ = hasAnyPixelsOnscreen;
                  return true;
              }
          }
          return partiallyShowing;
      };
      /**
       * Function to move the top app bar if needed.
       */
      MDCTopAppBarFoundation.prototype.moveTopAppBar_ = function () {
          if (this.checkForUpdate_()) {
              // Once the top app bar is fully hidden we use the max potential top app bar height as our offset
              // so the top app bar doesn't show if the window resizes and the new height > the old height.
              var offset = this.currentAppBarOffsetTop_;
              if (Math.abs(offset) >= this.topAppBarHeight_) {
                  offset = -numbers$4.MAX_TOP_APP_BAR_HEIGHT;
              }
              this.adapter_.setStyle('top', offset + 'px');
          }
      };
      /**
       * Throttled function that updates the top app bar scrolled values if the
       * top app bar height changes.
       */
      MDCTopAppBarFoundation.prototype.throttledResizeHandler_ = function () {
          var currentHeight = this.adapter_.getTopAppBarHeight();
          if (this.topAppBarHeight_ !== currentHeight) {
              this.wasDocked_ = false;
              // Since the top app bar has a different height depending on the screen width, this
              // will ensure that the top app bar remains in the correct location if
              // completely hidden and a resize makes the top app bar a different height.
              this.currentAppBarOffsetTop_ -= this.topAppBarHeight_ - currentHeight;
              this.topAppBarHeight_ = currentHeight;
          }
          this.handleTargetScroll();
      };
      return MDCTopAppBarFoundation;
  }(MDCTopAppBarBaseFoundation));

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
  var MDCFixedTopAppBarFoundation = /** @class */ (function (_super) {
      __extends(MDCFixedTopAppBarFoundation, _super);
      function MDCFixedTopAppBarFoundation() {
          var _this = _super !== null && _super.apply(this, arguments) || this;
          /**
           * State variable for the previous scroll iteration top app bar state
           */
          _this.wasScrolled_ = false;
          return _this;
      }
      /**
       * Scroll handler for applying/removing the modifier class on the fixed top app bar.
       * @override
       */
      MDCFixedTopAppBarFoundation.prototype.handleTargetScroll = function () {
          var currentScroll = this.adapter_.getViewportScrollY();
          if (currentScroll <= 0) {
              if (this.wasScrolled_) {
                  this.adapter_.removeClass(cssClasses$d.FIXED_SCROLLED_CLASS);
                  this.wasScrolled_ = false;
              }
          }
          else {
              if (!this.wasScrolled_) {
                  this.adapter_.addClass(cssClasses$d.FIXED_SCROLLED_CLASS);
                  this.wasScrolled_ = true;
              }
          }
      };
      return MDCFixedTopAppBarFoundation;
  }(MDCTopAppBarFoundation));

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
  var MDCShortTopAppBarFoundation = /** @class */ (function (_super) {
      __extends(MDCShortTopAppBarFoundation, _super);
      /* istanbul ignore next: optional argument is not a branch statement */
      function MDCShortTopAppBarFoundation(adapter) {
          var _this = _super.call(this, adapter) || this;
          _this.isCollapsed_ = false;
          _this.isAlwaysCollapsed_ = false;
          return _this;
      }
      Object.defineProperty(MDCShortTopAppBarFoundation.prototype, "isCollapsed", {
          // Public visibility for backward compatibility.
          get: function () {
              return this.isCollapsed_;
          },
          enumerable: true,
          configurable: true
      });
      MDCShortTopAppBarFoundation.prototype.init = function () {
          _super.prototype.init.call(this);
          if (this.adapter_.getTotalActionItems() > 0) {
              this.adapter_.addClass(cssClasses$d.SHORT_HAS_ACTION_ITEM_CLASS);
          }
          // If initialized with SHORT_COLLAPSED_CLASS, the bar should always be collapsed
          this.setAlwaysCollapsed(this.adapter_.hasClass(cssClasses$d.SHORT_COLLAPSED_CLASS));
      };
      /**
       * Set if the short top app bar should always be collapsed.
       *
       * @param value When `true`, bar will always be collapsed. When `false`, bar may collapse or expand based on scroll.
       */
      MDCShortTopAppBarFoundation.prototype.setAlwaysCollapsed = function (value) {
          this.isAlwaysCollapsed_ = !!value;
          if (this.isAlwaysCollapsed_) {
              this.collapse_();
          }
          else {
              // let maybeCollapseBar_ determine if the bar should be collapsed
              this.maybeCollapseBar_();
          }
      };
      MDCShortTopAppBarFoundation.prototype.getAlwaysCollapsed = function () {
          return this.isAlwaysCollapsed_;
      };
      /**
       * Scroll handler for applying/removing the collapsed modifier class on the short top app bar.
       * @override
       */
      MDCShortTopAppBarFoundation.prototype.handleTargetScroll = function () {
          this.maybeCollapseBar_();
      };
      MDCShortTopAppBarFoundation.prototype.maybeCollapseBar_ = function () {
          if (this.isAlwaysCollapsed_) {
              return;
          }
          var currentScroll = this.adapter_.getViewportScrollY();
          if (currentScroll <= 0) {
              if (this.isCollapsed_) {
                  this.uncollapse_();
              }
          }
          else {
              if (!this.isCollapsed_) {
                  this.collapse_();
              }
          }
      };
      MDCShortTopAppBarFoundation.prototype.uncollapse_ = function () {
          this.adapter_.removeClass(cssClasses$d.SHORT_COLLAPSED_CLASS);
          this.isCollapsed_ = false;
      };
      MDCShortTopAppBarFoundation.prototype.collapse_ = function () {
          this.adapter_.addClass(cssClasses$d.SHORT_COLLAPSED_CLASS);
          this.isCollapsed_ = true;
      };
      return MDCShortTopAppBarFoundation;
  }(MDCTopAppBarBaseFoundation));

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
  var MDCTopAppBar = /** @class */ (function (_super) {
      __extends(MDCTopAppBar, _super);
      function MDCTopAppBar() {
          return _super !== null && _super.apply(this, arguments) || this;
      }
      MDCTopAppBar.attachTo = function (root) {
          return new MDCTopAppBar(root);
      };
      MDCTopAppBar.prototype.initialize = function (rippleFactory) {
          if (rippleFactory === void 0) { rippleFactory = function (el) { return MDCRipple.attachTo(el); }; }
          this.navIcon_ = this.root_.querySelector(strings$b.NAVIGATION_ICON_SELECTOR);
          // Get all icons in the toolbar and instantiate the ripples
          var icons = [].slice.call(this.root_.querySelectorAll(strings$b.ACTION_ITEM_SELECTOR));
          if (this.navIcon_) {
              icons.push(this.navIcon_);
          }
          this.iconRipples_ = icons.map(function (icon) {
              var ripple = rippleFactory(icon);
              ripple.unbounded = true;
              return ripple;
          });
          this.scrollTarget_ = window;
      };
      MDCTopAppBar.prototype.initialSyncWithDOM = function () {
          this.handleNavigationClick_ = this.foundation_.handleNavigationClick.bind(this.foundation_);
          this.handleWindowResize_ = this.foundation_.handleWindowResize.bind(this.foundation_);
          this.handleTargetScroll_ = this.foundation_.handleTargetScroll.bind(this.foundation_);
          this.scrollTarget_.addEventListener('scroll', this.handleTargetScroll_);
          if (this.navIcon_) {
              this.navIcon_.addEventListener('click', this.handleNavigationClick_);
          }
          var isFixed = this.root_.classList.contains(cssClasses$d.FIXED_CLASS);
          var isShort = this.root_.classList.contains(cssClasses$d.SHORT_CLASS);
          if (!isShort && !isFixed) {
              window.addEventListener('resize', this.handleWindowResize_);
          }
      };
      MDCTopAppBar.prototype.destroy = function () {
          this.iconRipples_.forEach(function (iconRipple) { return iconRipple.destroy(); });
          this.scrollTarget_.removeEventListener('scroll', this.handleTargetScroll_);
          if (this.navIcon_) {
              this.navIcon_.removeEventListener('click', this.handleNavigationClick_);
          }
          var isFixed = this.root_.classList.contains(cssClasses$d.FIXED_CLASS);
          var isShort = this.root_.classList.contains(cssClasses$d.SHORT_CLASS);
          if (!isShort && !isFixed) {
              window.removeEventListener('resize', this.handleWindowResize_);
          }
          _super.prototype.destroy.call(this);
      };
      MDCTopAppBar.prototype.setScrollTarget = function (target) {
          // Remove scroll handler from the previous scroll target
          this.scrollTarget_.removeEventListener('scroll', this.handleTargetScroll_);
          this.scrollTarget_ = target;
          // Initialize scroll handler on the new scroll target
          this.handleTargetScroll_ =
              this.foundation_.handleTargetScroll.bind(this.foundation_);
          this.scrollTarget_.addEventListener('scroll', this.handleTargetScroll_);
      };
      MDCTopAppBar.prototype.getDefaultFoundation = function () {
          var _this = this;
          // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
          // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
          // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
          var adapter = {
              hasClass: function (className) { return _this.root_.classList.contains(className); },
              addClass: function (className) { return _this.root_.classList.add(className); },
              removeClass: function (className) { return _this.root_.classList.remove(className); },
              setStyle: function (property, value) { return _this.root_.style.setProperty(property, value); },
              getTopAppBarHeight: function () { return _this.root_.clientHeight; },
              notifyNavigationIconClicked: function () { return _this.emit(strings$b.NAVIGATION_EVENT, {}); },
              getViewportScrollY: function () {
                  var win = _this.scrollTarget_;
                  var el = _this.scrollTarget_;
                  return win.pageYOffset !== undefined ? win.pageYOffset : el.scrollTop;
              },
              getTotalActionItems: function () { return _this.root_.querySelectorAll(strings$b.ACTION_ITEM_SELECTOR).length; },
          };
          // tslint:enable:object-literal-sort-keys
          var foundation;
          if (this.root_.classList.contains(cssClasses$d.SHORT_CLASS)) {
              foundation = new MDCShortTopAppBarFoundation(adapter);
          }
          else if (this.root_.classList.contains(cssClasses$d.FIXED_CLASS)) {
              foundation = new MDCFixedTopAppBarFoundation(adapter);
          }
          else {
              foundation = new MDCTopAppBarFoundation(adapter);
          }
          return foundation;
      };
      return MDCTopAppBar;
  }(MDCComponent));

  /* node_modules\@smui\top-app-bar\TopAppBar.svelte generated by Svelte v3.18.1 */

  function create_fragment$w(ctx) {
  	let header;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[12].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[11], null);

  	let header_levels = [
  		{
  			class: "\n    mdc-top-app-bar\n    " + /*className*/ ctx[1] + "\n    " + (/*variant*/ ctx[2] === "short"
  			? "mdc-top-app-bar--short"
  			: "") + "\n    " + (/*collapsed*/ ctx[4]
  			? "mdc-top-app-bar--short-collapsed"
  			: "") + "\n    " + (/*variant*/ ctx[2] === "fixed"
  			? "mdc-top-app-bar--fixed"
  			: "") + "\n    " + (/*variant*/ ctx[2] === "static"
  			? "smui-top-app-bar--static"
  			: "") + "\n    " + (/*color*/ ctx[3] === "secondary"
  			? "smui-top-app-bar--color-secondary"
  			: "") + "\n    " + (/*prominent*/ ctx[5] ? "mdc-top-app-bar--prominent" : "") + "\n    " + (/*dense*/ ctx[6] ? "mdc-top-app-bar--dense" : "") + "\n  "
  		},
  		exclude(/*$$props*/ ctx[9], ["use", "class", "variant", "color", "collapsed", "prominent", "dense"])
  	];

  	let header_data = {};

  	for (let i = 0; i < header_levels.length; i += 1) {
  		header_data = assign(header_data, header_levels[i]);
  	}

  	return {
  		c() {
  			header = element("header");
  			if (default_slot) default_slot.c();
  			set_attributes(header, header_data);
  		},
  		m(target, anchor) {
  			insert(target, header, anchor);

  			if (default_slot) {
  				default_slot.m(header, null);
  			}

  			/*header_binding*/ ctx[13](header);
  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, header, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[8].call(null, header))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 2048) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[11], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[11], dirty, null));
  			}

  			set_attributes(header, get_spread_update(header_levels, [
  				dirty & /*className, variant, collapsed, color, prominent, dense*/ 126 && {
  					class: "\n    mdc-top-app-bar\n    " + /*className*/ ctx[1] + "\n    " + (/*variant*/ ctx[2] === "short"
  					? "mdc-top-app-bar--short"
  					: "") + "\n    " + (/*collapsed*/ ctx[4]
  					? "mdc-top-app-bar--short-collapsed"
  					: "") + "\n    " + (/*variant*/ ctx[2] === "fixed"
  					? "mdc-top-app-bar--fixed"
  					: "") + "\n    " + (/*variant*/ ctx[2] === "static"
  					? "smui-top-app-bar--static"
  					: "") + "\n    " + (/*color*/ ctx[3] === "secondary"
  					? "smui-top-app-bar--color-secondary"
  					: "") + "\n    " + (/*prominent*/ ctx[5] ? "mdc-top-app-bar--prominent" : "") + "\n    " + (/*dense*/ ctx[6] ? "mdc-top-app-bar--dense" : "") + "\n  "
  				},
  				dirty & /*exclude, $$props*/ 512 && exclude(/*$$props*/ ctx[9], ["use", "class", "variant", "color", "collapsed", "prominent", "dense"])
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
  			if (detaching) detach(header);
  			if (default_slot) default_slot.d(detaching);
  			/*header_binding*/ ctx[13](null);
  			run_all(dispose);
  		}
  	};
  }

  function instance$v($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component, ["MDCList:action"]);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { variant = "standard" } = $$props;
  	let { color = "primary" } = $$props;
  	let { collapsed = false } = $$props;
  	let { prominent = false } = $$props;
  	let { dense = false } = $$props;
  	let element;
  	let topAppBar;

  	onMount(() => {
  		topAppBar = new MDCTopAppBar(element);
  	});

  	onDestroy(() => {
  		topAppBar && topAppBar.destroy();
  	});

  	let { $$slots = {}, $$scope } = $$props;

  	function header_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(7, element = $$value);
  		});
  	}

  	$$self.$set = $$new_props => {
  		$$invalidate(9, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("variant" in $$new_props) $$invalidate(2, variant = $$new_props.variant);
  		if ("color" in $$new_props) $$invalidate(3, color = $$new_props.color);
  		if ("collapsed" in $$new_props) $$invalidate(4, collapsed = $$new_props.collapsed);
  		if ("prominent" in $$new_props) $$invalidate(5, prominent = $$new_props.prominent);
  		if ("dense" in $$new_props) $$invalidate(6, dense = $$new_props.dense);
  		if ("$$scope" in $$new_props) $$invalidate(11, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);

  	return [
  		use,
  		className,
  		variant,
  		color,
  		collapsed,
  		prominent,
  		dense,
  		element,
  		forwardEvents,
  		$$props,
  		topAppBar,
  		$$scope,
  		$$slots,
  		header_binding
  	];
  }

  class TopAppBar extends SvelteComponent {
  	constructor(options) {
  		super();

  		init(this, options, instance$v, create_fragment$w, safe_not_equal, {
  			use: 0,
  			class: 1,
  			variant: 2,
  			color: 3,
  			collapsed: 4,
  			prominent: 5,
  			dense: 6
  		});
  	}
  }

  var Row = classAdderBuilder({
    class: 'mdc-top-app-bar__row',
    component: Div,
    contexts: {}
  });

  /* node_modules\@smui\top-app-bar\Section.svelte generated by Svelte v3.18.1 */

  function create_fragment$x(ctx) {
  	let section;
  	let useActions_action;
  	let forwardEvents_action;
  	let current;
  	let dispose;
  	const default_slot_template = /*$$slots*/ ctx[7].default;
  	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[6], null);

  	let section_levels = [
  		{
  			class: "\n    mdc-top-app-bar__section\n    " + /*className*/ ctx[1] + "\n    " + (/*align*/ ctx[2] === "start"
  			? "mdc-top-app-bar__section--align-start"
  			: "") + "\n    " + (/*align*/ ctx[2] === "end"
  			? "mdc-top-app-bar__section--align-end"
  			: "") + "\n  "
  		},
  		/*toolbar*/ ctx[3] ? { role: "toolbar" } : {},
  		exclude(/*$$props*/ ctx[5], ["use", "class", "align", "toolbar"])
  	];

  	let section_data = {};

  	for (let i = 0; i < section_levels.length; i += 1) {
  		section_data = assign(section_data, section_levels[i]);
  	}

  	return {
  		c() {
  			section = element("section");
  			if (default_slot) default_slot.c();
  			set_attributes(section, section_data);
  		},
  		m(target, anchor) {
  			insert(target, section, anchor);

  			if (default_slot) {
  				default_slot.m(section, null);
  			}

  			current = true;

  			dispose = [
  				action_destroyer(useActions_action = useActions.call(null, section, /*use*/ ctx[0])),
  				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[4].call(null, section))
  			];
  		},
  		p(ctx, [dirty]) {
  			if (default_slot && default_slot.p && dirty & /*$$scope*/ 64) {
  				default_slot.p(get_slot_context(default_slot_template, ctx, /*$$scope*/ ctx[6], null), get_slot_changes(default_slot_template, /*$$scope*/ ctx[6], dirty, null));
  			}

  			set_attributes(section, get_spread_update(section_levels, [
  				dirty & /*className, align*/ 6 && {
  					class: "\n    mdc-top-app-bar__section\n    " + /*className*/ ctx[1] + "\n    " + (/*align*/ ctx[2] === "start"
  					? "mdc-top-app-bar__section--align-start"
  					: "") + "\n    " + (/*align*/ ctx[2] === "end"
  					? "mdc-top-app-bar__section--align-end"
  					: "") + "\n  "
  				},
  				dirty & /*toolbar*/ 8 && (/*toolbar*/ ctx[3] ? { role: "toolbar" } : {}),
  				dirty & /*exclude, $$props*/ 32 && exclude(/*$$props*/ ctx[5], ["use", "class", "align", "toolbar"])
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
  			if (detaching) detach(section);
  			if (default_slot) default_slot.d(detaching);
  			run_all(dispose);
  		}
  	};
  }

  function instance$w($$self, $$props, $$invalidate) {
  	const forwardEvents = forwardEventsBuilder(current_component, ["MDCList:action"]);
  	let { use = [] } = $$props;
  	let { class: className = "" } = $$props;
  	let { align = "start" } = $$props;
  	let { toolbar = false } = $$props;

  	setContext("SMUI:icon-button:context", toolbar
  	? "top-app-bar:action"
  	: "top-app-bar:navigation");

  	setContext("SMUI:button:context", toolbar
  	? "top-app-bar:action"
  	: "top-app-bar:navigation");

  	let { $$slots = {}, $$scope } = $$props;

  	$$self.$set = $$new_props => {
  		$$invalidate(5, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
  		if ("use" in $$new_props) $$invalidate(0, use = $$new_props.use);
  		if ("class" in $$new_props) $$invalidate(1, className = $$new_props.class);
  		if ("align" in $$new_props) $$invalidate(2, align = $$new_props.align);
  		if ("toolbar" in $$new_props) $$invalidate(3, toolbar = $$new_props.toolbar);
  		if ("$$scope" in $$new_props) $$invalidate(6, $$scope = $$new_props.$$scope);
  	};

  	$$props = exclude_internal_props($$props);
  	return [use, className, align, toolbar, forwardEvents, $$props, $$scope, $$slots];
  }

  class Section extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$w, create_fragment$x, safe_not_equal, { use: 0, class: 1, align: 2, toolbar: 3 });
  	}
  }

  classAdderBuilder({
    class: 'mdc-top-app-bar__title',
    component: Span,
    contexts: {}
  });

  /* App.svelte generated by Svelte v3.18.1 */

  function create_default_slot_23$1(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("menu");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (53:6) <Button on:click={toggleDrawer}>
  function create_default_slot_22$1(ctx) {
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_23$1] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(icon.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(icon, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const icon_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				icon_changes.$$scope = { dirty, ctx };
  			}

  			icon.$set(icon_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(icon.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(icon.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(icon, detaching);
  		}
  	};
  }

  // (52:4) <Section>
  function create_default_slot_21$1(ctx) {
  	let current;

  	const button = new Button_1({
  			props: {
  				$$slots: { default: [create_default_slot_22$1] },
  				$$scope: { ctx }
  			}
  		});

  	button.$on("click", /*toggleDrawer*/ ctx[3]);

  	return {
  		c() {
  			create_component(button.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(button, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const button_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				button_changes.$$scope = { dirty, ctx };
  			}

  			button.$set(button_changes);
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
  		}
  	};
  }

  // (58:4) <Section align="end" toolbar>
  function create_default_slot_20$1(ctx) {
  	let span;

  	return {
  		c() {
  			span = element("span");
  			span.textContent = "YEP ! YEP ! YEP !";
  		},
  		m(target, anchor) {
  			insert(target, span, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(span);
  		}
  	};
  }

  // (51:2) <Row>
  function create_default_slot_19$1(ctx) {
  	let t;
  	let current;

  	const section0 = new Section({
  			props: {
  				$$slots: { default: [create_default_slot_21$1] },
  				$$scope: { ctx }
  			}
  		});

  	const section1 = new Section({
  			props: {
  				align: "end",
  				toolbar: true,
  				$$slots: { default: [create_default_slot_20$1] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(section0.$$.fragment);
  			t = space();
  			create_component(section1.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(section0, target, anchor);
  			insert(target, t, anchor);
  			mount_component(section1, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const section0_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				section0_changes.$$scope = { dirty, ctx };
  			}

  			section0.$set(section0_changes);
  			const section1_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				section1_changes.$$scope = { dirty, ctx };
  			}

  			section1.$set(section1_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(section0.$$.fragment, local);
  			transition_in(section1.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(section0.$$.fragment, local);
  			transition_out(section1.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(section0, detaching);
  			if (detaching) detach(t);
  			destroy_component(section1, detaching);
  		}
  	};
  }

  // (50:0) <TopAppBar variant="static" {prominent} {dense} color={secondaryColor ? 'secondary' : 'primary'}>
  function create_default_slot_18$1(ctx) {
  	let current;

  	const row = new Row({
  			props: {
  				$$slots: { default: [create_default_slot_19$1] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(row.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(row, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const row_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				row_changes.$$scope = { dirty, ctx };
  			}

  			row.$set(row_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(row.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(row.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(row, detaching);
  		}
  	};
  }

  // (65:4) <Title>
  function create_default_slot_17$1(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("YEP");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (66:4) <Subtitle>
  function create_default_slot_16$1(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("yep yep yep !");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (64:2) <Header>
  function create_default_slot_15$1(ctx) {
  	let t;
  	let current;

  	const title = new Title({
  			props: {
  				$$slots: { default: [create_default_slot_17$1] },
  				$$scope: { ctx }
  			}
  		});

  	const subtitle = new Subtitle({
  			props: {
  				$$slots: { default: [create_default_slot_16$1] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(title.$$.fragment);
  			t = space();
  			create_component(subtitle.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(title, target, anchor);
  			insert(target, t, anchor);
  			mount_component(subtitle, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const title_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				title_changes.$$scope = { dirty, ctx };
  			}

  			title.$set(title_changes);
  			const subtitle_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				subtitle_changes.$$scope = { dirty, ctx };
  			}

  			subtitle.$set(subtitle_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(title.$$.fragment, local);
  			transition_in(subtitle.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(title.$$.fragment, local);
  			transition_out(subtitle.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(title, detaching);
  			if (detaching) detach(t);
  			destroy_component(subtitle, detaching);
  		}
  	};
  }

  // (72:10) <Icon class="material-icons">
  function create_default_slot_14$1(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("home");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (71:8) <Button>
  function create_default_slot_13$1(ctx) {
  	let current;

  	const icon = new Icon({
  			props: {
  				class: "material-icons",
  				$$slots: { default: [create_default_slot_14$1] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(icon.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(icon, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const icon_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				icon_changes.$$scope = { dirty, ctx };
  			}

  			icon.$set(icon_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(icon.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(icon.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(icon, detaching);
  		}
  	};
  }

  // (70:6) <Item href="/" on:click={toggleDrawer}>
  function create_default_slot_12$1(ctx) {
  	let current;

  	const button = new Button_1({
  			props: {
  				$$slots: { default: [create_default_slot_13$1] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(button.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(button, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const button_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				button_changes.$$scope = { dirty, ctx };
  			}

  			button.$set(button_changes);
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
  		}
  	};
  }

  // (78:8) <Button>
  function create_default_slot_11$1(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("counter");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (77:6) <Item on:click={() => toggleAndMove('/counter')}>
  function create_default_slot_10$1(ctx) {
  	let current;

  	const button = new Button_1({
  			props: {
  				$$slots: { default: [create_default_slot_11$1] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(button.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(button, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const button_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				button_changes.$$scope = { dirty, ctx };
  			}

  			button.$set(button_changes);
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
  		}
  	};
  }

  // (81:8) <Button>
  function create_default_slot_9$2(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("switch");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (80:6) <Item on:click={() => toggleAndMove('/switch')}>
  function create_default_slot_8$2(ctx) {
  	let current;

  	const button = new Button_1({
  			props: {
  				$$slots: { default: [create_default_slot_9$2] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(button.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(button, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const button_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				button_changes.$$scope = { dirty, ctx };
  			}

  			button.$set(button_changes);
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
  		}
  	};
  }

  // (84:8) <Button>
  function create_default_slot_7$2(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("jouer");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (83:6) <Item on:click={() => toggleAndMove('/game')}>
  function create_default_slot_6$2(ctx) {
  	let current;

  	const button = new Button_1({
  			props: {
  				$$slots: { default: [create_default_slot_7$2] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(button.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(button, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const button_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				button_changes.$$scope = { dirty, ctx };
  			}

  			button.$set(button_changes);
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
  		}
  	};
  }

  // (87:8) <Button>
  function create_default_slot_5$3(ctx) {
  	let t;

  	return {
  		c() {
  			t = text("jouer 2");
  		},
  		m(target, anchor) {
  			insert(target, t, anchor);
  		},
  		d(detaching) {
  			if (detaching) detach(t);
  		}
  	};
  }

  // (86:6) <Item on:click={() => toggleAndMove('/game2')}>
  function create_default_slot_4$3(ctx) {
  	let current;

  	const button = new Button_1({
  			props: {
  				$$slots: { default: [create_default_slot_5$3] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(button.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(button, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const button_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				button_changes.$$scope = { dirty, ctx };
  			}

  			button.$set(button_changes);
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
  		}
  	};
  }

  // (69:4) <List>
  function create_default_slot_3$3(ctx) {
  	let t0;
  	let t1;
  	let t2;
  	let t3;
  	let t4;
  	let current;

  	const item0 = new Item({
  			props: {
  				href: "/",
  				$$slots: { default: [create_default_slot_12$1] },
  				$$scope: { ctx }
  			}
  		});

  	item0.$on("click", /*toggleDrawer*/ ctx[3]);
  	const separator = new Separator({});

  	const item1 = new Item({
  			props: {
  				$$slots: { default: [create_default_slot_10$1] },
  				$$scope: { ctx }
  			}
  		});

  	item1.$on("click", /*click_handler*/ ctx[5]);

  	const item2 = new Item({
  			props: {
  				$$slots: { default: [create_default_slot_8$2] },
  				$$scope: { ctx }
  			}
  		});

  	item2.$on("click", /*click_handler_1*/ ctx[6]);

  	const item3 = new Item({
  			props: {
  				$$slots: { default: [create_default_slot_6$2] },
  				$$scope: { ctx }
  			}
  		});

  	item3.$on("click", /*click_handler_2*/ ctx[7]);

  	const item4 = new Item({
  			props: {
  				$$slots: { default: [create_default_slot_4$3] },
  				$$scope: { ctx }
  			}
  		});

  	item4.$on("click", /*click_handler_3*/ ctx[8]);

  	return {
  		c() {
  			create_component(item0.$$.fragment);
  			t0 = space();
  			create_component(separator.$$.fragment);
  			t1 = space();
  			create_component(item1.$$.fragment);
  			t2 = space();
  			create_component(item2.$$.fragment);
  			t3 = space();
  			create_component(item3.$$.fragment);
  			t4 = space();
  			create_component(item4.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(item0, target, anchor);
  			insert(target, t0, anchor);
  			mount_component(separator, target, anchor);
  			insert(target, t1, anchor);
  			mount_component(item1, target, anchor);
  			insert(target, t2, anchor);
  			mount_component(item2, target, anchor);
  			insert(target, t3, anchor);
  			mount_component(item3, target, anchor);
  			insert(target, t4, anchor);
  			mount_component(item4, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const item0_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				item0_changes.$$scope = { dirty, ctx };
  			}

  			item0.$set(item0_changes);
  			const item1_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				item1_changes.$$scope = { dirty, ctx };
  			}

  			item1.$set(item1_changes);
  			const item2_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				item2_changes.$$scope = { dirty, ctx };
  			}

  			item2.$set(item2_changes);
  			const item3_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				item3_changes.$$scope = { dirty, ctx };
  			}

  			item3.$set(item3_changes);
  			const item4_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				item4_changes.$$scope = { dirty, ctx };
  			}

  			item4.$set(item4_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(item0.$$.fragment, local);
  			transition_in(separator.$$.fragment, local);
  			transition_in(item1.$$.fragment, local);
  			transition_in(item2.$$.fragment, local);
  			transition_in(item3.$$.fragment, local);
  			transition_in(item4.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(item0.$$.fragment, local);
  			transition_out(separator.$$.fragment, local);
  			transition_out(item1.$$.fragment, local);
  			transition_out(item2.$$.fragment, local);
  			transition_out(item3.$$.fragment, local);
  			transition_out(item4.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(item0, detaching);
  			if (detaching) detach(t0);
  			destroy_component(separator, detaching);
  			if (detaching) detach(t1);
  			destroy_component(item1, detaching);
  			if (detaching) detach(t2);
  			destroy_component(item2, detaching);
  			if (detaching) detach(t3);
  			destroy_component(item3, detaching);
  			if (detaching) detach(t4);
  			destroy_component(item4, detaching);
  		}
  	};
  }

  // (68:2) <Content>
  function create_default_slot_2$4(ctx) {
  	let current;

  	const list = new List({
  			props: {
  				$$slots: { default: [create_default_slot_3$3] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(list.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(list, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const list_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				list_changes.$$scope = { dirty, ctx };
  			}

  			list.$set(list_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(list.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(list.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(list, detaching);
  		}
  	};
  }

  // (63:0) <Drawer variant="modal" bind:this={drawer} bind:open={drawerOpen}>
  function create_default_slot_1$6(ctx) {
  	let t;
  	let current;

  	const header = new Header({
  			props: {
  				$$slots: { default: [create_default_slot_15$1] },
  				$$scope: { ctx }
  			}
  		});

  	const content = new Content({
  			props: {
  				$$slots: { default: [create_default_slot_2$4] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(header.$$.fragment);
  			t = space();
  			create_component(content.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(header, target, anchor);
  			insert(target, t, anchor);
  			mount_component(content, target, anchor);
  			current = true;
  		},
  		p(ctx, dirty) {
  			const header_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				header_changes.$$scope = { dirty, ctx };
  			}

  			header.$set(header_changes);
  			const content_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				content_changes.$$scope = { dirty, ctx };
  			}

  			content.$set(content_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(header.$$.fragment, local);
  			transition_in(content.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(header.$$.fragment, local);
  			transition_out(content.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(header, detaching);
  			if (detaching) detach(t);
  			destroy_component(content, detaching);
  		}
  	};
  }

  // (93:0) <AppContent>
  function create_default_slot$9(ctx) {
  	let current;
  	const router = new Router({ props: { routes: /*routes*/ ctx[2] } });

  	return {
  		c() {
  			create_component(router.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(router, target, anchor);
  			current = true;
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
  			destroy_component(router, detaching);
  		}
  	};
  }

  function create_fragment$y(ctx) {
  	let t0;
  	let updating_open;
  	let t1;
  	let t2;
  	let current;

  	const topappbar = new TopAppBar({
  			props: {
  				variant: "static",
  				prominent,
  				dense,
  				color:  "primary",
  				$$slots: { default: [create_default_slot_18$1] },
  				$$scope: { ctx }
  			}
  		});

  	function drawer_1_open_binding(value) {
  		/*drawer_1_open_binding*/ ctx[10].call(null, value);
  	}

  	let drawer_1_props = {
  		variant: "modal",
  		$$slots: { default: [create_default_slot_1$6] },
  		$$scope: { ctx }
  	};

  	if (/*drawerOpen*/ ctx[1] !== void 0) {
  		drawer_1_props.open = /*drawerOpen*/ ctx[1];
  	}

  	const drawer_1 = new Drawer({ props: drawer_1_props });
  	/*drawer_1_binding*/ ctx[9](drawer_1);
  	binding_callbacks.push(() => bind(drawer_1, "open", drawer_1_open_binding));
  	const scrim = new Scrim({});

  	const appcontent = new AppContent({
  			props: {
  				$$slots: { default: [create_default_slot$9] },
  				$$scope: { ctx }
  			}
  		});

  	return {
  		c() {
  			create_component(topappbar.$$.fragment);
  			t0 = space();
  			create_component(drawer_1.$$.fragment);
  			t1 = space();
  			create_component(scrim.$$.fragment);
  			t2 = space();
  			create_component(appcontent.$$.fragment);
  		},
  		m(target, anchor) {
  			mount_component(topappbar, target, anchor);
  			insert(target, t0, anchor);
  			mount_component(drawer_1, target, anchor);
  			insert(target, t1, anchor);
  			mount_component(scrim, target, anchor);
  			insert(target, t2, anchor);
  			mount_component(appcontent, target, anchor);
  			current = true;
  		},
  		p(ctx, [dirty]) {
  			const topappbar_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				topappbar_changes.$$scope = { dirty, ctx };
  			}

  			topappbar.$set(topappbar_changes);
  			const drawer_1_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				drawer_1_changes.$$scope = { dirty, ctx };
  			}

  			if (!updating_open && dirty & /*drawerOpen*/ 2) {
  				updating_open = true;
  				drawer_1_changes.open = /*drawerOpen*/ ctx[1];
  				add_flush_callback(() => updating_open = false);
  			}

  			drawer_1.$set(drawer_1_changes);
  			const appcontent_changes = {};

  			if (dirty & /*$$scope*/ 2048) {
  				appcontent_changes.$$scope = { dirty, ctx };
  			}

  			appcontent.$set(appcontent_changes);
  		},
  		i(local) {
  			if (current) return;
  			transition_in(topappbar.$$.fragment, local);
  			transition_in(drawer_1.$$.fragment, local);
  			transition_in(scrim.$$.fragment, local);
  			transition_in(appcontent.$$.fragment, local);
  			current = true;
  		},
  		o(local) {
  			transition_out(topappbar.$$.fragment, local);
  			transition_out(drawer_1.$$.fragment, local);
  			transition_out(scrim.$$.fragment, local);
  			transition_out(appcontent.$$.fragment, local);
  			current = false;
  		},
  		d(detaching) {
  			destroy_component(topappbar, detaching);
  			if (detaching) detach(t0);
  			/*drawer_1_binding*/ ctx[9](null);
  			destroy_component(drawer_1, detaching);
  			if (detaching) detach(t1);
  			destroy_component(scrim, detaching);
  			if (detaching) detach(t2);
  			destroy_component(appcontent, detaching);
  		}
  	};
  }

  let prominent = false;
  let dense = false;

  function instance$x($$self, $$props, $$invalidate) {
  	const routes = {
  		"/": Empty,
  		// Exact path
  		// Using named parameters, with last being optional
  		"/counter": Counter,
  		// Wildcard parameter
  		"/switch": Switcher,
  		"/game": Game,
  		"/game2": Game2,
  		// Catch-all
  		// This is optional, but if present it must be the last
  		"*": NotFound
  	};

  	let drawer;
  	let drawerOpen = false;

  	function toggleDrawer() {
  		$$invalidate(1, drawerOpen = !drawerOpen);
  		console.log("toggling drawer to -> " + drawerOpen);
  	}

  	function toggleAndMove(to) {
  		toggleDrawer();
  		push(to);
  	}

  	const click_handler = () => toggleAndMove("/counter");
  	const click_handler_1 = () => toggleAndMove("/switch");
  	const click_handler_2 = () => toggleAndMove("/game");
  	const click_handler_3 = () => toggleAndMove("/game2");

  	function drawer_1_binding($$value) {
  		binding_callbacks[$$value ? "unshift" : "push"](() => {
  			$$invalidate(0, drawer = $$value);
  		});
  	}

  	function drawer_1_open_binding(value) {
  		drawerOpen = value;
  		$$invalidate(1, drawerOpen);
  	}

  	return [
  		drawer,
  		drawerOpen,
  		routes,
  		toggleDrawer,
  		toggleAndMove,
  		click_handler,
  		click_handler_1,
  		click_handler_2,
  		click_handler_3,
  		drawer_1_binding,
  		drawer_1_open_binding
  	];
  }

  class App extends SvelteComponent {
  	constructor(options) {
  		super();
  		init(this, options, instance$x, create_fragment$y, safe_not_equal, {});
  	}
  }

  window.app = new App({
    target: document.getElementsByTagName('app')[0]
  });

}());
//# sourceMappingURL=bundle.js.map
