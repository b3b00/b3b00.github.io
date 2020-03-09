import { writable } from 'svelte/store';

// export const count = writable(0);

// export const switched = writable(true);

export const netStatus = writable(true);



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
  }
  
  export const count = createWritableStore('count', 0);

  export const switched = createWritableStore('switched',false);