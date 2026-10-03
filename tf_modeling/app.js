(function () {
  const solver = tf_modeling;
  const board = document.getElementById("board");
  const resultEl = document.getElementById("result");
  const hintEl = document.getElementById("hint");
  const inspector = document.getElementById("inspector");
  const nameInput = document.getElementById("name");
  const valueInput = document.getElementById("value");
  const netInput = document.getElementById("net");
  const ghost = document.getElementById("ghost");
  const STORAGE = "tf_modeling-doc-v1";

  const view = { x: -1, y: -1, w: 18, h: 16 };
  let state = load() || clone(solver.examples().teiler);
  let tool = "select";
  let selected = null;
  let drag = null;
  let wireStart = null;
  let preview = null;
  let resultText = "Tippe auf Lösen. Die Formel entsteht auf diesem Gerät.";

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function uid(prefix) {
    return prefix + Math.random().toString(36).slice(2, 8);
  }

  function save() {
    localStorage.setItem(STORAGE, JSON.stringify(state));
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.components)) return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function setExample(name) {
    state = name ? clone(solver.examples()[name]) : { components: [], wires: [], labels: [] };
    selected = null;
    wireStart = null;
    preview = null;
    resultText = name ? "Beispiel geladen. Tippe auf Lösen." : "Ziehe Bauteile auf die Fläche.";
    save();
    render();
  }

  function clientToUser(x, y) {
    const ctm = board.getScreenCTM();
    if (!ctm) return { x: view.x + view.w / 2, y: view.y + view.h / 2 };
    const point = board.createSVGPoint();
    point.x = x;
    point.y = y;
    const mapped = point.matrixTransform(ctm.inverse());
    return { x: mapped.x, y: mapped.y };
  }

  function nextIdentity(type) {
    const used = new Set(state.components.map(function (comp) { return comp.name; }));
    const prefix = { R: "R", C: "C", L: "L", V: "V", I: "I", G: "Gm", O: "Op", GND: "GND" }[type];
    let i = 1;
    let name = prefix + i;
    while (used.has(name)) name = prefix + ++i;
    const value = { V: "vin", I: "iin", G: "gm", O: "1", GND: "" }[type] || name;
    return { name: name, value: value };
  }

  function place(type, x, y) {
    const identity = nextIdentity(type);
    const comp = {
      id: uid("c"),
      type: type,
      name: identity.name,
      value: identity.value,
      x: x,
      y: y,
      rot: 0,
    };
    state.components.push(comp);
    selected = { kind: "part", id: comp.id };
    resultText = "Bauteil gesetzt. Tippe auf Lösen.";
    save();
    render();
  }

  function selectedPart() {
    if (!selected || selected.kind !== "part") return null;
    return state.components.find(function (comp) { return comp.id === selected.id; }) || null;
  }

  function symbolPath(type) {
    if (type === "R") return '<polyline class="symbol" points="-2,0 -1.15,0 -0.9,0.42 -0.45,-0.42 0,0.42 0.45,-0.42 0.9,0.42 1.15,0 2,0"/>';
    if (type === "C") return '<line class="symbol" x1="-2" y1="0" x2="-0.28" y2="0"/><line class="symbol" x1="-0.28" y1="-0.7" x2="-0.28" y2="0.7"/><line class="symbol" x1="0.28" y1="-0.7" x2="0.28" y2="0.7"/><line class="symbol" x1="0.28" y1="0" x2="2" y2="0"/>';
    if (type === "L") return '<path class="symbol" d="M-2 0 H-1.2 A0.4 0.4 0 1 1 -0.4 0 A0.4 0.4 0 1 1 0.4 0 A0.4 0.4 0 1 1 1.2 0 H2"/>';
    if (type === "V") return '<line class="symbol" x1="0" y1="-2" x2="0" y2="-1"/><circle class="symbol" cx="0" cy="0" r="1"/><line class="symbol" x1="0" y1="1" x2="0" y2="2"/><text font-size="0.7" x="-0.22" y="-0.15">+</text><text font-size="0.7" x="-0.22" y="0.62">−</text>';
    if (type === "I") return '<line class="symbol" x1="0" y1="-2" x2="0" y2="-1"/><circle class="symbol" cx="0" cy="0" r="1"/><line class="symbol" x1="0" y1="1" x2="0" y2="2"/><path class="symbol" d="M0 -0.45 V0.45 M-0.28 0.05 L0 0.45 L0.28 0.05"/>';
    if (type === "G") return '<line class="symbol" x1="-2" y1="-1" x2="-1.2" y2="-1"/><line class="symbol" x1="-2" y1="1" x2="-1.2" y2="1"/><line class="symbol" x1="1.2" y1="-1" x2="2" y2="-1"/><line class="symbol" x1="1.2" y1="1" x2="2" y2="1"/><rect class="symbol" x="-1.2" y="-1.35" width="2.4" height="2.7" rx="0.15"/><path class="symbol" d="M-0.7 0 H0.45 M0.1 -0.28 L0.55 0 L0.1 0.28"/>';
    if (type === "O") return '<polygon class="symbol" points="-1.3,-1.15 -1.3,1.15 1.35,0"/><line class="symbol" x1="-2" y1="-1" x2="-1.3" y2="-1"/><line class="symbol" x1="-2" y1="1" x2="-1.3" y2="1"/><line class="symbol" x1="1.35" y1="0" x2="2" y2="0"/><text font-size="0.55" x="-1.15" y="-0.45">+</text><text font-size="0.55" x="-1.15" y="0.85">−</text>';
    return '<line class="symbol" x1="-0.7" y1="0" x2="0.7" y2="0"/><line class="symbol" x1="-0.45" y1="0.28" x2="0.45" y2="0.28"/><line class="symbol" x1="-0.22" y1="0.52" x2="0.22" y2="0.52"/>';
  }

  function render() {
    const dots = [];
    const x0 = Math.floor(view.x);
    const y0 = Math.floor(view.y);
    const x1 = Math.ceil(view.x + view.w);
    const y1 = Math.ceil(view.y + view.h);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) dots.push('<circle class="dot" cx="' + x + '" cy="' + y + '" r="0.045"/>');
    }
    const wires = (state.wires || []).map(function (wire) {
      const points = wire.points.map(function (p) { return p.x + "," + p.y; }).join(" ");
      return '<polyline class="wire" points="' + points + '"/>';
    }).join("");
    const previewMarkup = preview
      ? '<polyline class="wire preview" points="' + preview.map(function (p) { return p.x + "," + p.y; }).join(" ") + '"/>'
      : "";
    const parts = state.components.map(function (comp) {
      const pins = solver.pinPositions(comp).map(function (pin) {
        return '<circle class="pinhit" data-pin="' + comp.id + ":" + pin.id + '" cx="' + pin.x + '" cy="' + pin.y + '" r="0.72"/><circle class="pin" cx="' + pin.x + '" cy="' + pin.y + '" r="0.12"/>';
      }).join("");
      const selectedClass = selected && selected.kind === "part" && selected.id === comp.id ? " selected" : "";
      return '<g class="part' + selectedClass + '" data-comp="' + comp.id + '" transform="translate(' + comp.x + " " + comp.y + ") rotate(" + (comp.rot || 0) + ')">' + symbolPath(comp.type) + "</g>" + pins;
    }).join("");
    const captions = state.components.map(function (comp) {
      if (comp.type === "GND") return "";
      const text = comp.type === "O" ? comp.name : (comp.value || comp.name);
      const rot = ((comp.rot || 0) % 360 + 360) % 360;
      const alongY = comp.type === "V" || comp.type === "I" ? rot % 180 === 0 : rot % 180 === 90;
      const beside = alongY || comp.type === "O" || comp.type === "G";
      const x = beside ? comp.x + (comp.type === "O" || comp.type === "G" ? 2.55 : 1.7) : comp.x;
      const y = beside ? comp.y + 0.15 : comp.y + 1.25;
      return '<text class="caption" font-size="0.48" x="' + x + '" y="' + y + '" text-anchor="' + (beside ? "start" : "middle") + '">' + escapeText(text) + "</text>";
    }).join("");
    const labels = (state.labels || []).map(function (label) {
      return '<text class="netlabel" font-size="0.48" x="' + (label.x + 0.25) + '" y="' + (label.y - 0.25) + '">' + escapeText(label.text) + "</text>";
    }).join("");
    board.setAttribute("viewBox", view.x + " " + view.y + " " + view.w + " " + view.h);
    board.innerHTML = '<g fill="#cfc4b4">' + dots.join("") + "</g>" + wires + previewMarkup + parts + captions + labels;
    hintEl.hidden = state.components.length > 0;
    resultEl.textContent = resultText;
    const part = selectedPart();
    inspector.hidden = !part && !(selected && selected.kind === "net");
    nameInput.parentElement.hidden = !part || part.type === "GND";
    valueInput.parentElement.hidden = !part || part.type === "GND" || part.type === "O";
    netInput.parentElement.hidden = !(selected && selected.kind === "net");
    if (part && document.activeElement !== nameInput && document.activeElement !== valueInput) {
      nameInput.value = part.name;
      valueInput.value = part.value;
    }
    if (selected && selected.kind === "net" && document.activeElement !== netInput) {
      const found = (state.labels || []).find(function (label) { return label.x === selected.x && label.y === selected.y; });
      netInput.value = found ? found.text : "";
    }
    document.querySelectorAll(".tools button[data-tool]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.tool === tool);
    });
  }

  function escapeText(text) {
    return String(text).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }

  function solve() {
    const solved = solver.solveSchematic(state);
    if (!solved.ok) {
      resultText = solved.error;
      render();
      return;
    }
    const ratios = solved.ratios || {};
    const preferred = Object.keys(ratios).filter(function (name) {
      const text = ratios[name].text;
      return name !== "0" && text !== "0" && text !== "1" && text !== "vin" && text !== solved.source;
    });
    const names = (preferred.length ? preferred : Object.keys(solved.voltages)).slice();
    names.sort(function (a, b) {
      if (a === "out") return -1;
      if (b === "out") return 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    if (!names.length) {
      resultText = "Keine Knotenspannung.";
    } else if (solved.source) {
      resultText = names.map(function (name) {
        const shown = ratios[name] ? ratios[name].text : solved.voltages[name].text;
        return "V(" + name + ") / " + solved.source + " = " + shown;
      }).join("\n");
    } else {
      resultText = names.map(function (name) {
        return "V(" + name + ") = " + solved.voltages[name].text;
      }).join("\n");
    }
    render();
  }

  function orthogonal(a, b) {
    if (a.x === b.x || a.y === b.y) return [a, b];
    const mid = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    return [a, mid, b];
  }

  board.addEventListener("pointerdown", function (event) {
    if (drag && drag.kind === "new") return;
    const pin = event.target.closest("[data-pin]");
    const part = event.target.closest("[data-comp]");
    board.setPointerCapture(event.pointerId);
    const here = clientToUser(event.clientX, event.clientY);
    if (tool === "wire" && pin) {
      wireStart = { x: Number(pin.getAttribute("cx")), y: Number(pin.getAttribute("cy")) };
      preview = [wireStart, { x: Math.round(here.x), y: Math.round(here.y) }];
      event.preventDefault();
      render();
      return;
    }
    if (pin && tool === "select") {
      const compId = pin.getAttribute("data-pin").split(":")[0];
      const comp = state.components.find(function (item) { return item.id === compId; });
      selected = {
        kind: "net",
        x: Number(pin.getAttribute("cx")),
        y: Number(pin.getAttribute("cy")),
        partId: comp.id,
      };
      drag = {
        kind: "move",
        id: comp.id,
        fromNet: true,
        moved: false,
        pins: solver.pinPositions(comp).map(function (item) { return { x: item.x, y: item.y }; }),
        grab: { x: here.x - comp.x, y: here.y - comp.y },
      };
      event.preventDefault();
      render();
      return;
    }
    if (part && tool === "select") {
      const comp = state.components.find(function (item) { return item.id === part.dataset.comp; });
      selected = { kind: "part", id: comp.id };
      drag = {
        kind: "move",
        id: comp.id,
        pointer: event.pointerId,
        origin: { x: comp.x, y: comp.y },
        pins: solver.pinPositions(comp).map(function (item) { return { x: item.x, y: item.y }; }),
        grab: { x: here.x - comp.x, y: here.y - comp.y },
      };
      event.preventDefault();
      render();
      return;
    }
    selected = null;
    drag = { kind: "pan", pointer: event.pointerId, x: event.clientX, y: event.clientY, viewx: view.x, viewy: view.y };
    render();
  });

  board.addEventListener("pointermove", function (event) {
    const here = clientToUser(event.clientX, event.clientY);
    if (wireStart) {
      const end = { x: Math.round(here.x), y: Math.round(here.y) };
      preview = orthogonal(wireStart, end);
      render();
      return;
    }
    if (drag && drag.kind === "move") {
      const comp = state.components.find(function (item) { return item.id === drag.id; });
      const nx = Math.round(here.x - drag.grab.x);
      const ny = Math.round(here.y - drag.grab.y);
      const dx = nx - comp.x;
      const dy = ny - comp.y;
      if (!dx && !dy) return;
      drag.moved = true;
      comp.x = nx;
      comp.y = ny;
      (state.wires || []).forEach(function (wire) {
        wire.points.forEach(function (point) {
          if (drag.pins.some(function (pin) { return pin.x === point.x && pin.y === point.y; })) {
            point.x += dx;
            point.y += dy;
          }
        });
      });
      (state.labels || []).forEach(function (label) {
        if (drag.pins.some(function (pin) { return pin.x === label.x && pin.y === label.y; })) {
          label.x += dx;
          label.y += dy;
        }
      });
      drag.pins = drag.pins.map(function (pin) { return { x: pin.x + dx, y: pin.y + dy }; });
      render();
      return;
    }
    if (drag && drag.kind === "pan") {
      const scale = view.w / board.clientWidth;
      view.x = drag.viewx - (event.clientX - drag.x) * scale;
      view.y = drag.viewy - (event.clientY - drag.y) * scale;
      render();
    }
  });

  board.addEventListener("pointerup", function (event) {
    if (wireStart) {
      const pin = document.elementFromPoint(event.clientX, event.clientY);
      const target = pin && pin.closest ? pin.closest("[data-pin]") : null;
      if (target) {
        const end = { x: Number(target.getAttribute("cx")), y: Number(target.getAttribute("cy")) };
        if (end.x !== wireStart.x || end.y !== wireStart.y) {
          state.wires.push({ id: uid("w"), points: orthogonal(wireStart, end) });
          resultText = "Draht gesetzt. Tippe auf Lösen.";
          save();
        }
      }
      wireStart = null;
      preview = null;
      render();
    }
    if (drag && drag.kind === "move") {
      if (!(drag.fromNet && !drag.moved)) selected = { kind: "part", id: drag.id };
      save();
      render();
    }
    if (drag && drag.kind !== "new") drag = null;
  });

  document.getElementById("palette").addEventListener("pointerdown", function (event) {
    const button = event.target.closest("[data-type]");
    if (!button) return;
    event.preventDefault();
    drag = { kind: "new", type: button.dataset.type, x: event.clientX, y: event.clientY };
    button.setPointerCapture(event.pointerId);
    ghost.hidden = false;
    ghost.textContent = button.textContent.trim();
    ghost.style.left = event.clientX + "px";
    ghost.style.top = event.clientY + "px";
  });

  document.getElementById("palette").addEventListener("pointermove", function (event) {
    if (!drag || drag.kind !== "new") return;
    ghost.style.left = event.clientX + "px";
    ghost.style.top = event.clientY + "px";
  });

  document.getElementById("palette").addEventListener("pointerup", function (event) {
    if (!drag || drag.kind !== "new") return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const onBoard = hit === board || (hit && hit.closest && hit.closest("#board"));
    if (onBoard) {
      const point = clientToUser(event.clientX, event.clientY);
      place(drag.type, Math.round(point.x), Math.round(point.y));
    } else if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 10) {
      let x = Math.round(view.x + view.w / 2);
      const y = Math.round(view.y + view.h / 2);
      while (state.components.some(function (comp) { return comp.x === x && comp.y === y; })) x += 3;
      place(drag.type, x, y);
    }
    drag = null;
    ghost.hidden = true;
  });

  document.getElementById("examples").addEventListener("click", function (event) {
    const button = event.target.closest("[data-example]");
    if (!button) return;
    setExample(button.dataset.example || "");
  });

  document.querySelector(".tools").addEventListener("click", function (event) {
    const button = event.target.closest("[data-tool]");
    if (!button) return;
    tool = button.dataset.tool;
    wireStart = null;
    preview = null;
    render();
  });

  document.getElementById("solve").addEventListener("click", solve);
  function zoom(factor) {
    const cx = view.x + view.w / 2;
    const cy = view.y + view.h / 2;
    view.w *= factor;
    view.h *= factor;
    view.x = cx - view.w / 2;
    view.y = cy - view.h / 2;
    render();
  }
  document.getElementById("zoom-in").addEventListener("click", function () { zoom(0.8); });
  document.getElementById("zoom-out").addEventListener("click", function () { zoom(1.25); });
  document.getElementById("rotate").addEventListener("click", function () {
    const part = selectedPart();
    if (!part) return;
    const before = solver.pinPositions(part);
    part.rot = ((part.rot || 0) + 90) % 360;
    const after = solver.pinPositions(part);
    before.forEach(function (pin, index) {
      (state.wires || []).forEach(function (wire) {
        wire.points.forEach(function (point) {
          if (point.x === pin.x && point.y === pin.y) {
            point.x = after[index].x;
            point.y = after[index].y;
          }
        });
      });
      (state.labels || []).forEach(function (label) {
        if (label.x === pin.x && label.y === pin.y) {
          label.x = after[index].x;
          label.y = after[index].y;
        }
      });
    });
    save();
    render();
  });
  document.getElementById("delete").addEventListener("click", function () {
    const id = selected && (selected.kind === "part" ? selected.id : selected.partId);
    if (!id) return;
    state.components = state.components.filter(function (comp) { return comp.id !== id; });
    selected = null;
    save();
    render();
  });

  nameInput.addEventListener("input", function () {
    const part = selectedPart();
    if (!part) return;
    part.name = nameInput.value.trim() || part.name;
    save();
    render();
  });
  valueInput.addEventListener("input", function () {
    const part = selectedPart();
    if (!part) return;
    part.value = valueInput.value.trim();
    save();
    render();
  });
  netInput.addEventListener("input", function () {
    if (!selected || selected.kind !== "net") return;
    const text = netInput.value.trim();
    state.labels = (state.labels || []).filter(function (label) {
      return !(label.x === selected.x && label.y === selected.y);
    });
    if (text) state.labels.push({ id: uid("n"), x: selected.x, y: selected.y, text: text });
    save();
    render();
  });

  document.addEventListener("keydown", function (event) {
    const typing = document.activeElement && document.activeElement.tagName === "INPUT";
    if (typing && event.key !== "Enter") return;
    if (event.key === "Delete" || event.key === "Backspace") {
      document.getElementById("delete").click();
    }
    if (event.key === "r" || event.key === "R") document.getElementById("rotate").click();
    if (event.key === "Enter") solve();
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  render();
})();
