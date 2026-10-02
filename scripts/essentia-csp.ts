import type { Plugin } from 'vite';

/** Essentia 0.1.3's old Embind glue generates wrappers with Function.
 * Equivalent closures let the bundled WASM run without allowing unsafe-eval.
 * Fail the build if upstream changes, rather than silently shipping unsafe glue.
 */
export function makeEssentiaCspSafe(source: string): string {
  const replacements = [
    ['function createNamedFunction(', 'function extendError(', `function createNamedFunction(name, body) {
      const wrapper = function() { "use strict"; return body.apply(this, arguments); };
      Object.defineProperty(wrapper, 'name', { value: makeLegalFunctionName(name) });
      return wrapper;
    }`],
    ['function embind__requireFunction(', 'var UnboundTypeError=', `function embind__requireFunction(signature, rawFunction) {
      signature = readLatin1String(signature);
      const dynCall = Module['dynCall_' + signature];
      if (typeof dynCall !== 'function') {
        throwBindingError('unknown function pointer with signature ' + signature + ': ' + rawFunction);
      }
      return function() {
        const args = [rawFunction];
        for (let i = 1; i < signature.length; i++) args.push(arguments[i - 1]);
        return dynCall.apply(undefined, args);
      };
    }`],
    ['function craftEmvalAllocator(', 'var emval_newers=', `function craftEmvalAllocator(argCount) {
      return function(constructor, argTypes, args) {
        const values = [];
        for (let i = 0; i < argCount; i++) {
          const type = requireRegisteredType(Module.HEAP32[(argTypes >>> 2) + i], 'parameter ' + i);
          values.push(type.readValueFromPointer(args));
          args += type.argPackAdvance;
        }
        return __emval_register(Reflect.construct(constructor, values));
      };
    }`],
    ['function craftInvokerFunction(', 'function __embind_register_class_function(', `function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc) {
      if (argTypes.length < 2) throwBindingError('argTypes array size mismatch!');
      const isMethod = argTypes[1] !== null && classType !== null;
      const needsStack = argTypes.slice(1).some(type => type !== null && type.destructorFunction === undefined);
      return createNamedFunction(humanName, function() {
        if (arguments.length !== argTypes.length - 2) {
          throwBindingError('function ' + humanName + ' called with ' + arguments.length + ' arguments, expected ' + (argTypes.length - 2) + ' args!');
        }
        const destructors = needsStack ? [] : null;
        const wired = [cppTargetFunc];
        if (isMethod) wired.push(argTypes[1].toWireType(destructors, this));
        for (let i = 2; i < argTypes.length; i++) wired.push(argTypes[i].toWireType(destructors, arguments[i - 2]));
        const result = cppInvokerFunc.apply(null, wired);
        if (needsStack) runDestructors(destructors);
        else for (let i = isMethod ? 1 : 2; i < argTypes.length; i++) {
          const destructor = argTypes[i].destructorFunction;
          if (destructor !== null) destructor(wired[i - (isMethod ? 0 : 1)]);
        }
        if (argTypes[0].name !== 'void') return argTypes[0].fromWireType(result);
      });
    }`],
    ['function __emval_get_method_caller(', 'function __emval_get_module_property(', `function __emval_get_method_caller(argCount, argTypes) {
      const types = __emval_lookupTypes(argCount, argTypes);
      return __emval_addMethodCaller(function(handle, name, destructors, args) {
        const values = [];
        for (let i = 1; i < types.length; i++) {
          values.push(types[i].readValueFromPointer(args));
          args += types[i].argPackAdvance;
        }
        const result = handle[name].apply(handle, values);
        for (let i = 1; i < types.length; i++) if (types[i].deleteObject) types[i].deleteObject(values[i - 1]);
        if (!types[0].isVoid) return types[0].toWireType(destructors, result);
      });
    }`],
    ['function emval_get_global(', 'function __emval_get_global(', 'function emval_get_global() { return globalThis; }'],
  ];
  for (const [start, end, replacement] of replacements) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    if (from < 0 || to < 0 || !source.slice(from, to).includes('Function')) {
      throw new Error(`Essentia CSP compatibility needs review: ${start}`);
    }
    source = source.slice(0, from) + replacement + source.slice(to);
  }
  if (/\bnew\s+Function\s*\(|\bnew_\(Function\s*,|\beval\s*\(/.test(source)) {
    throw new Error('Essentia still contains dynamic code generation.');
  }
  return source;
}

export function essentiaCsp(): Plugin {
  return {
    name: 'essentia-csp',
    enforce: 'pre',
    transform(source, id) {
      if (id.replaceAll('\\', '/').endsWith('/essentia.js/dist/essentia-wasm.es.js')) {
        return { code: makeEssentiaCspSafe(source), map: null };
      }
      return null;
    },
  };
}
