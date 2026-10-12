(function(){
'use strict';

/* ---------------- utils ---------------- */

function pad(n){ return n.toString().padStart(2,'0'); }

function isoDate(d){
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}
function isoToDate(iso){
  var parts = iso.split('-').map(Number);
  return new Date(parts[0], parts[1]-1, parts[2]);
}
function todayIso(){ return isoDate(new Date()); }
function currentHourStr(){ return pad(new Date().getHours())+':00'; }

var WEEKDAY_KO = ['일','월','화','수','목','금','토'];
function dateLabel(iso){
  var d = isoToDate(iso);
  return (d.getMonth()+1)+'월 '+d.getDate()+'일 '+WEEKDAY_KO[d.getDay()];
}
function shortDate(iso){
  var d = isoToDate(iso);
  return (d.getMonth()+1)+'.'+d.getDate();
}

function contentEditableToText(el){
  var html = el.innerHTML;
  html = html.replace(/<div><br\s*\/?><\/div>/gi, '\n');
  html = html.replace(/<\/div><div>/gi, '\n');
  html = html.replace(/<div>/gi, '');
  html = html.replace(/<\/div>/gi, '');
  html = html.replace(/<br\s*\/?>/gi, '\n');
  var tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

// Enter/Space activation for elements with role="button": lets keyboard
// users trigger the same action a click would, without each caller
// re-writing the same key check.
function onActivateKey(el, handler){
  el.addEventListener('keydown', function(e){
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); handler(e); }
  });
}

// Runs fn() when Enter is pressed. While the Korean IME is still composing the
// last syllable, that Enter only confirms the syllable (the page sees
// isComposing / keyCode 229), so a plain "ignore it" check makes the user press
// Enter twice. Here fn() runs once the composition has ended instead.
// Returns a function that detaches the listeners.
function onEnter(el, fn){
  var waiting = false;
  function onStart(){ waiting = false; }
  function onKey(e){
    if(e.isComposing || e.keyCode === 229){
      if(e.code === 'Enter') waiting = true;
      return;
    }
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); fn(e); }
  }
  function onEnd(){
    if(!waiting) return;
    waiting = false;
    setTimeout(fn, 0);
  }
  el.addEventListener('compositionstart', onStart);
  el.addEventListener('keydown', onKey);
  el.addEventListener('compositionend', onEnd);
  return function(){
    el.removeEventListener('compositionstart', onStart);
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('compositionend', onEnd);
  };
}

function placeCaretAtEnd(el){
  el.focus();
  var range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
function placeCaretAtStart(el){
  el.focus();
  var range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// Whether the caret sits at the absolute start/end of a div that holds at
// most one text node (true of every live-slot / edit-textarea here). Used
// to detect "nowhere further up/down to go within this div" without any
// layout math: we let the arrow key's native caret move happen first, then
// check where it landed (see handleVerticalNav).
function caretAtAbsoluteStart(div){
  var sel = window.getSelection();
  if(!sel.rangeCount) return true;
  var r = sel.getRangeAt(0);
  if(!r.collapsed) return false;
  if(r.startContainer === div) return r.startOffset === 0;
  if(r.startContainer === div.firstChild) return r.startOffset === 0;
  return false;
}
function caretAtAbsoluteEnd(div){
  var sel = window.getSelection();
  if(!sel.rangeCount) return true;
  var r = sel.getRangeAt(0);
  if(!r.collapsed) return false;
  if(r.startContainer === div) return r.startOffset === div.childNodes.length;
  if(r.startContainer === div.firstChild) return r.startOffset === div.firstChild.textContent.length;
  return false;
}

function buildNavTargets(){
  var targets = [];
  dayData.entries.forEach(function(g){
    g.items.forEach(function(_, idx){
      targets.push({hour: g.hour, kind: 'item', idx: idx});
    });
    targets.push({hour: g.hour, kind: 'live'});
  });
  return targets;
}
function sameTarget(a, hour, kind, idx){
  return a.hour === hour && a.kind === kind && (kind !== 'item' || a.idx === idx);
}
function focusTarget(target, caretPos){
  if(!target) return false;
  if(target.kind === 'live'){
    var slot = document.querySelector('.live-slot[data-hour="'+target.hour+'"]');
    if(!slot) return false;
    if(caretPos === 'start') placeCaretAtStart(slot); else placeCaretAtEnd(slot);
  } else {
    focusEditableAt(target.hour, target.idx, caretPos);
  }
  return true;
}
// Lets arrow-up/down move between log entries as if they were one
// continuous text box, instead of being trapped inside whichever
// line's own contenteditable div currently has focus.
//
// We don't preventDefault up front: there's no reliable layout-free way to
// know in advance whether the caret is on the div's first/last *visual*
// line (wrapped text has no simple offset check for that). Instead we let
// the arrow key's native caret move happen, then check on the next tick
// whether it landed on the absolute start/end of the div's text - which is
// exactly what "nothing left to do here, hand off to the next entry" means.
function handleVerticalNav(e, div, hour, kind, idx, composing){
  if(composing || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  var goingUp = e.key === 'ArrowUp';
  var goingDown = e.key === 'ArrowDown';
  if(!goingUp && !goingDown) return;

  setTimeout(function(){
    var atBoundary = goingUp ? caretAtAbsoluteStart(div) : caretAtAbsoluteEnd(div);
    if(!atBoundary) return;
    var targets = buildNavTargets();
    var i = -1;
    for(var k=0;k<targets.length;k++){
      if(sameTarget(targets[k], hour, kind, idx)){ i = k; break; }
    }
    if(i === -1) return;
    var targetIdx = goingUp ? i - 1 : i + 1;
    if(targetIdx < 0 || targetIdx >= targets.length) return;
    focusTarget(targets[targetIdx], goingUp ? 'end' : 'start');
  }, 0);
}

function placeCaretAtOffset(el, offset){
  el.focus();
  var textNode = el.firstChild;
  var range = document.createRange();
  if(textNode && textNode.nodeType === Node.TEXT_NODE){
    var pos = Math.max(0, Math.min(offset, textNode.textContent.length));
    range.setStart(textNode, pos);
  } else {
    range.selectNodeContents(el);
  }
  range.collapse(true);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function textOffsetFromPoint(container, x, y){
  if(!document.caretRangeFromPoint) return null;
  var range = document.caretRangeFromPoint(x, y);
  if(!range || !container.contains(range.startContainer)) return null;
  var offset = 0;
  var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  var node;
  while((node = walker.nextNode())){
    if(node === range.startContainer) return offset + range.startOffset;
    offset += node.textContent.length;
  }
  return offset;
}

function splitAtCaret(div){
  var sel = window.getSelection();
  if(!sel.rangeCount) return [contentEditableToText(div), ''];
  var range = sel.getRangeAt(0);
  var beforeRange = range.cloneRange();
  beforeRange.selectNodeContents(div);
  beforeRange.setEnd(range.endContainer, range.endOffset);
  var afterRange = range.cloneRange();
  afterRange.selectNodeContents(div);
  afterRange.setStart(range.endContainer, range.endOffset);
  var beforeWrap = document.createElement('div');
  beforeWrap.appendChild(beforeRange.cloneContents());
  var afterWrap = document.createElement('div');
  afterWrap.appendChild(afterRange.cloneContents());
  return [contentEditableToText(beforeWrap), contentEditableToText(afterWrap)];
}

/* ---------------- tags ---------------- */

var TAG_COLORS = [
  {dot:'#7F77DD', bg:'#EEEDFE', text:'#3C3489'},
  {dot:'#1D9E75', bg:'#E1F5EE', text:'#085041'},
  {dot:'#D85A30', bg:'#FAECE7', text:'#712B13'},
  {dot:'#D4537E', bg:'#FBEAF0', text:'#72243E'},
  {dot:'#BA7517', bg:'#FAEEDA', text:'#633806'},
  {dot:'#378ADD', bg:'#E6F1FB', text:'#0C447C'},
  {dot:'#639922', bg:'#EAF3DE', text:'#27500A'},
  {dot:'#888780', bg:'#F1EFE8', text:'#444441'},
  {dot:'#E24B4A', bg:'#FCEBEB', text:'#791F1F'}
];
// tag name -> palette index, loaded from disk at startup (see init()) so the
// same tag keeps the same color across restarts, and persisted here the
// moment a brand-new tag claims a slot. Assigning the lowest still-unused
// index (instead of hashing straight into the palette) means distinct tags
// never collide on the same color until there are more tags than colors.
var tagColorMap = {};
function tagColor(tag){
  if(!(tag in tagColorMap)) assignTagColor(tag);
  return TAG_COLORS[tagColorMap[tag] % TAG_COLORS.length];
}
function assignTagColor(tag){
  var used = {};
  Object.keys(tagColorMap).forEach(function(t){ used[tagColorMap[t]] = true; });
  var idx = -1;
  for(var i=0;i<TAG_COLORS.length;i++){
    if(!used[i]){ idx = i; break; }
  }
  if(idx === -1){
    var hash = 0;
    for(var j=0;j<tag.length;j++){ hash = (hash*31 + tag.charCodeAt(j)) >>> 0; }
    idx = hash % TAG_COLORS.length;
  }
  tagColorMap[tag] = idx;
  if(api) api.assign_tag_color(tag, idx);
}
function escapeHtml(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function renderInlineTags(text){
  var esc = escapeHtml(text);
  return esc.replace(/#([\w가-힣]+)/g, function(m, name){
    var c = tagColor(name);
    return '<span class="tag-pill-inline" data-tag="'+name+'" style="background:'+c.bg+'; color:'+c.text+'">#'+name+'</span>';
  });
}
var PLAN_PREFIX = '[예정] ';

// dateIso: the day this entry belongs to; the ◇ mark (same as the calendar's)
// shows only until that day has passed. It hangs in the left gutter so it
// doesn't disturb the tag-column alignment.
function renderEntryContent(text, dateIso){
  var planned = text.indexOf(PLAN_PREFIX) === 0;
  if(planned) text = text.slice(PLAN_PREFIX.length);
  var mark = (planned && (dateIso || selectedDate) >= todayIso()) ? '<span class="plan-diamond" title="예정">◇</span>' : '';
  var lines = text.split('\n');
  return mark + lines.map(function(line){
    // IME composition can occasionally leave stray leading whitespace on a
    // line; strip it before testing so a leading #tag still gets detected.
    line = line.replace(/^[ \t]+/, '');
    var leadMatch = line.match(/^#([\w가-힣]+)\s?/);
    if(leadMatch){
      var tagName = leadMatch[1];
      var rest = line.slice(leadMatch[0].length);
      var c = tagColor(tagName);
      var pillHtml = '<span class="tag-slot"><span class="tag-pill-inline" data-tag="'+tagName+'" style="background:'+c.bg+'; color:'+c.text+'">#'+tagName+'</span></span>';
      var restHtml = '<span class="rest-text">' + renderInlineTags(rest) + '</span>';
      return '<div class="tagged-line">' + pillHtml + restHtml + '</div>';
    }
    return '<div class="plain-line">' + renderInlineTags(line) + '</div>';
  }).join('');
}
function extractTags(text){
  var tags = [];
  var re = /#([\w가-힣]+)/g;
  var m;
  while((m = re.exec(text)) !== null){ tags.push(m[1]); }
  return tags;
}

/* ---------------- state ---------------- */

var api = null;

var viewYear, viewMonth;
var selectedDate = todayIso();
var monthTags = {};       // { "9": ["tag1","tag2"] }
var monthOcc = {};        // { "12": [occurrence, ...] } upcoming recurring occurrences
var monthPlans = {};      // { "12": true } days holding an entry marked 예정
var nextItems = [];       // [{done,text,added,doneDate}]
var dayData = { entries: [], focus: null, mood: null };
var saveTimer = null;
var currentHourWatch = currentHourStr();

var initial = isoToDate(selectedDate);
viewYear = initial.getFullYear();
viewMonth = initial.getMonth()+1;

/* ---------------- persistence ---------------- */

function scheduleSave(){
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 500);
}
function flushSave(){
  if(saveTimer){ clearTimeout(saveTimer); saveTimer = null; }
  var dateAtSave = selectedDate;
  var entriesAtSave = dayData.entries;
  var focusAtSave = dayData.focus;
  var moodAtSave = dayData.mood;
  api.save_day(dateAtSave, entriesAtSave, focusAtSave, moodAtSave);
  updateMonthTagsLocally(dateAtSave, entriesAtSave);
}
function updateMonthTagsLocally(dateStr, entries){
  var d = isoToDate(dateStr);
  if(d.getFullYear() !== viewYear || (d.getMonth()+1) !== viewMonth) return;
  var seen = [];
  entries.forEach(function(g){
    g.items.forEach(function(it){
      extractTags(it).forEach(function(t){
        if(seen.indexOf(t) === -1) seen.push(t);
      });
    });
  });
  var day = d.getDate();
  if(seen.length){ monthTags[String(day)] = seen.slice(0,4); }
  else { delete monthTags[String(day)]; }
  var hasPlan = entries.some(function(g){
    return g.items.some(function(it){ return it.indexOf(PLAN_PREFIX) === 0; });
  });
  if(hasPlan) monthPlans[String(day)] = true; else delete monthPlans[String(day)];
  renderCalendarDots();
}

window.addEventListener('blur', flushSave);

/* ---------------- loading ---------------- */

function loadMonth(){
  document.getElementById('cal-title').textContent = viewYear + '년 ' + viewMonth + '월';
  Promise.all([
    api.get_month_tags(viewYear, viewMonth),
    api.get_next_list(),
    api.get_month_plans(viewYear, viewMonth),
    api.get_month_occurrences(viewYear, viewMonth)
  ]).then(function(results){
    monthOcc = {};
    (results[3] || []).forEach(function(o){
      var day = String(isoToDate(o.date).getDate());
      (monthOcc[day] = monthOcc[day] || []).push(o);
    });
    monthTags = results[0] || {};
    nextItems = results[1] || [];
    monthPlans = {};
    (results[2] || []).forEach(function(d){ monthPlans[String(d)] = true; });
    renderCalendar();
    renderNextList();
  });
}

function loadDay(dateStr){
  document.getElementById('selected-date-label').textContent = dateLabel(dateStr);
  api.get_day(dateStr).then(function(data){
    dayData = {
      entries: (data.entries || []).map(function(g){ return {hour:g.hour, items:g.items.slice()}; }),
      focus: data.focus || null,
      mood: data.mood || null
    };
    ensureCurrentHourGroup();
    renderEntries();
    renderStatus();
    loadTimer(dateStr);
  });
}

function switchToDate(dateStr){
  closeSearch();
  closeRecur();
  flushSave();
  selectedDate = dateStr;
  loadDay(selectedDate);
  renderCalendarSelection();
}

function ensureCurrentHourGroup(){
  if(selectedDate !== todayIso()) return;
  var hour = currentHourStr();
  var exists = dayData.entries.some(function(g){ return g.hour === hour; });
  if(!exists){
    dayData.entries.push({hour:hour, items:[]});
  }
  dayData.entries.sort(function(a,b){ return a.hour.localeCompare(b.hour); });
}

/* ---------------- calendar ---------------- */

function inMonth(d){ return d.getFullYear() === viewYear && (d.getMonth()+1) === viewMonth; }
function daysInView(){ return new Date(viewYear, viewMonth, 0).getDate(); }

function computeTodoMarks(){
  var daysCount = daysInView();
  var marks = {};
  function addMark(day, opts){
    if(day < 1 || day > daysCount) return;
    var m = marks[day] || (marks[day] = {});
    if(opts.barLeft) m.barLeft = true;
    if(opts.barRight) m.barRight = true;
    if(opts.dot) m.dot = opts.dot;
  }
  var monthFirst = new Date(viewYear, viewMonth-1, 1);
  var monthLast = new Date(viewYear, viewMonth-1, daysCount);

  nextItems.forEach(function(item){
    var start = isoToDate(item.added);
    var startInView = inMonth(start);
    if(!item.done){
      if(startInView) addMark(start.getDate(), {dot:'open'});
      return;
    }
    var end = isoToDate(item.doneDate || item.added);
    if(end < start) end = start;
    var endInView = inMonth(end);

    if(!startInView && !endInView){
      if(start < monthFirst && end > monthLast){
        for(var d=1; d<=daysCount; d++) addMark(d, {barLeft:true, barRight:true});
      }
      return;
    }
    if(start.getTime() === end.getTime()){
      if(startInView) addMark(start.getDate(), {dot:'closed'});
      return;
    }
    var startDay = startInView ? start.getDate() : 1;
    var endDay = endInView ? end.getDate() : daysCount;
    if(startInView) addMark(startDay, {barRight:true, dot:'open'});
    else addMark(startDay, {barLeft:true, barRight:true});
    for(var dd=startDay+1; dd<endDay; dd++) addMark(dd, {barLeft:true, barRight:true});
    if(endInView) addMark(endDay, {barLeft:true, dot:'closed'});
    else addMark(endDay, {barLeft:true, barRight:true});
  });
  return marks;
}

function renderCalendar(){
  var grid = document.getElementById('cal-grid');
  grid.innerHTML = '';
  var firstDay = new Date(viewYear, viewMonth-1, 1).getDay();
  var daysCount = daysInView();
  var todayStr = todayIso();
  var marks = computeTodoMarks();

  for(var i=0;i<firstDay;i++){
    var empty = document.createElement('div');
    empty.className = 'cal-cell empty';
    grid.appendChild(empty);
  }

  for(var day=1; day<=daysCount; day++){
    var dateStr = viewYear+'-'+pad(viewMonth)+'-'+pad(day);
    var cell = document.createElement('div');
    cell.className = 'cal-cell';
    if(dateStr === todayStr) cell.classList.add('is-today');
    if(dateStr === selectedDate) cell.classList.add('selected');
    cell.setAttribute('data-date', dateStr);

    var dayNum = document.createElement('div');
    dayNum.className = 'day-num';
    dayNum.textContent = day;
    cell.appendChild(dayNum);

    var dotRow = document.createElement('div');
    dotRow.className = 'dot-row';
    fillDotRow(dotRow, day);
    cell.appendChild(dotRow);

    var todoRow = document.createElement('div');
    todoRow.className = 'todo-row';
    var mark = marks[day];
    if(mark){
      if(mark.barLeft){
        var bl = document.createElement('span');
        bl.className = 'todo-bar todo-bar-left';
        todoRow.appendChild(bl);
      }
      if(mark.barRight){
        var br = document.createElement('span');
        br.className = 'todo-bar todo-bar-right';
        todoRow.appendChild(br);
      }
      if(mark.dot){
        var dotEl = document.createElement('span');
        dotEl.className = 'todo-dot ' + (mark.dot === 'closed' ? 'todo-dot-closed' : 'todo-dot-open');
        todoRow.appendChild(dotEl);
      }
    }
    cell.appendChild(todoRow);

    cell.addEventListener('click', function(){
      switchToDate(this.getAttribute('data-date'));
    });

    grid.appendChild(cell);
  }
}

function renderCalendarSelection(){
  document.querySelectorAll('.cal-cell').forEach(function(c){
    c.classList.toggle('selected', c.getAttribute('data-date') === selectedDate);
  });
}

function fillDotRow(row, day){
  row.innerHTML = '';
  (monthTags[String(day)] || []).forEach(function(tag){
    var dot = document.createElement('span');
    dot.className = 'tag-dot';
    dot.style.background = tagColor(tag).dot;
    row.appendChild(dot);
  });
  // ◇ = something planned for a day that hasn't passed yet
  var dateStr = viewYear+'-'+pad(viewMonth)+'-'+pad(day);
  var occs = monthOcc[String(day)];
  if((monthPlans[String(day)] || occs) && dateStr >= todayIso()){
    var mark = document.createElement('span');
    mark.className = 'plan-mark';
    mark.textContent = '◇';
    if(occs){
      mark.classList.add('plan-click');
      mark.title = '이번 회차 날짜 변경';
      mark.addEventListener('click', function(e){
        e.stopPropagation();
        openOccPopup(mark, day);
      });
    }
    row.appendChild(mark);
  }
}

function renderCalendarDots(){
  document.querySelectorAll('.cal-cell').forEach(function(c){
    var dateStr = c.getAttribute('data-date');
    if(!dateStr) return;
    var day = isoToDate(dateStr).getDate();
    fillDotRow(c.querySelector('.dot-row'), day);
  });
}

document.getElementById('prev-month').addEventListener('click', function(){
  viewMonth--;
  if(viewMonth < 1){ viewMonth = 12; viewYear--; }
  loadMonth();
});
document.getElementById('next-month').addEventListener('click', function(){
  viewMonth++;
  if(viewMonth > 12){ viewMonth = 1; viewYear++; }
  loadMonth();
});
document.querySelectorAll('.nav-arrow').forEach(function(btn){
  onActivateKey(btn, function(){ btn.click(); });
});

/* ---------------- next list ---------------- */

var pendingNoteIdx = -1; // set right after completing an item, so its note box opens on the next render

// The optional "why was this late" note under a next item: shown as "↳ text",
// as a hover-only "↳ 메모 추가" on completed items without one, or as an editor.
function renderNoteSlot(slot, item, idx, expanded){
  slot.innerHTML = '';
  if(item.note && !expanded){
    var fold = document.createElement('div');
    fold.className = 'next-note-add has-note';
    fold.textContent = '↳ 메모';
    fold.title = '메모 보기';
    fold.addEventListener('click', function(){ renderNoteSlot(slot, item, idx, true); });
    slot.appendChild(fold);
  } else if(item.note){
    var view = document.createElement('div');
    view.className = 'next-note';
    var arrow = document.createElement('span');
    arrow.className = 'note-arrow';
    arrow.textContent = '↳';
    var text = document.createElement('span');
    text.textContent = item.note;
    function foldNote(e){ e.stopPropagation(); renderNoteSlot(slot, item, idx, false); }
    arrow.className += ' note-toggle';
    arrow.title = '메모 접기';
    arrow.addEventListener('click', foldNote);
    var close = document.createElement('span');
    close.className = 'note-fold';
    close.textContent = '접기';
    close.addEventListener('click', foldNote);
    text.addEventListener('click', function(){ openNoteEditor(slot, item, idx); });
    view.appendChild(arrow);
    view.appendChild(text);
    view.appendChild(close);
    slot.appendChild(view);
  } else if(item.done){
    var add = document.createElement('div');
    add.className = 'next-note-add';
    add.textContent = '↳ 메모 추가';
    add.addEventListener('click', function(){ openNoteEditor(slot, item, idx); });
    slot.appendChild(add);
  }
}

function openNoteEditor(slot, item, idx){
  slot.innerHTML = '';
  var wrap = document.createElement('div');
  wrap.className = 'note-edit';
  var arrow = document.createElement('span');
  arrow.className = 'note-arrow';
  arrow.textContent = '↳';
  var input = document.createElement('div');
  input.className = 'note-input';
  input.contentEditable = 'plaintext-only';
  input.textContent = item.note || '';
  wrap.appendChild(arrow);
  wrap.appendChild(input);
  var hint = document.createElement('div');
  hint.className = 'note-hint';
  hint.textContent = 'Enter 저장 · Esc 건너뛰기';
  slot.appendChild(wrap);
  slot.appendChild(hint);
  placeCaretAtEnd(input);

  var done = false;
  function finish(commit){
    if(done) return;
    done = true;
    var value = contentEditableToText(input).replace(/\s+/g, ' ').trim();
    if(commit && value !== (item.note || '')){
      api.set_next_note(idx, value).then(function(items){
        nextItems = items;
        renderNextList();
      });
    } else {
      renderNoteSlot(slot, item, idx);
    }
  }
  onEnter(input, function(){ finish(true); });
  input.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){ e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', function(){ finish(true); });
}

// A date in the item's meta line; clicking it opens the native date picker.
// min/max keep start <= done (the backend enforces the same).
function dateField(idx, which, value, min, max){
  var span = document.createElement('span');
  span.className = 'next-date';
  span.title = which === 'added' ? '시작일 수정' : '완료일 수정';
  span.textContent = shortDate(value);
  var input = document.createElement('input');
  input.type = 'date';
  input.value = value;
  if(min) input.min = min;
  if(max) input.max = max;
  input.tabIndex = -1;
  span.appendChild(input);
  span.addEventListener('click', function(){
    try{ input.showPicker(); }catch(err){ input.focus(); }
  });
  input.addEventListener('click', function(e){ e.stopPropagation(); });
  input.addEventListener('change', function(){
    if(!input.value || input.value === value) return;
    api.set_next_date(idx, which, input.value).then(function(items){
      nextItems = items;
      renderNextList();
      renderCalendar();
    });
  });
  return span;
}

function renderNextList(){
  var box = document.getElementById('next-list');
  box.innerHTML = '';
  var openNote = pendingNoteIdx;
  pendingNoteIdx = -1;
  nextItems.forEach(function(item, idx){
    var row = document.createElement('div');
    row.className = 'next-item' + (item.done ? ' done' : '');

    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = item.done;
    cb.addEventListener('change', function(){
      api.toggle_next(idx, cb.checked).then(function(items){
        nextItems = items;
        if(items[idx] && items[idx].done && !items[idx].note) pendingNoteIdx = idx;
        renderNextList();
        renderCalendar();
      });
    });

    var textCol = document.createElement('div');
    textCol.className = 'next-col';
    var textEl = document.createElement('div');
    textEl.className = 'next-text';
    textEl.textContent = item.text;
    textEl.addEventListener('click', function(e){
      if(textEl.classList.contains('editing')) return;
      editNextItem(textEl, idx, item.text, e);
    });
    var metaEl = document.createElement('div');
    metaEl.className = 'next-meta';
    metaEl.appendChild(dateField(idx, 'added', item.added, null, item.done ? (item.doneDate || item.added) : null));
    if(item.done){
      metaEl.appendChild(document.createTextNode(' → '));
      metaEl.appendChild(dateField(idx, 'done', item.doneDate || item.added, item.added, null));
    }
    textCol.appendChild(textEl);
    textCol.appendChild(metaEl);
    var noteSlot = document.createElement('div');
    textCol.appendChild(noteSlot);
    renderNoteSlot(noteSlot, item, idx);

    var delBtn = document.createElement('div');
    delBtn.className = 'next-delete';
    delBtn.setAttribute('role', 'button');
    delBtn.setAttribute('tabindex', '0');
    delBtn.setAttribute('aria-label', '할 일 삭제');
    delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    function doDelete(){
      api.delete_next(idx).then(function(items){
        nextItems = items;
        renderNextList();
        renderCalendar();
      });
    }
    delBtn.addEventListener('click', doDelete);
    onActivateKey(delBtn, doDelete);

    row.appendChild(cb);
    row.appendChild(textCol);
    row.appendChild(delBtn);
    box.appendChild(row);
    // Only once the row is in the document can the editor take focus.
    if(idx === openNote) openNoteEditor(noteSlot, item, idx);
  });
}

// Edits in place by making the existing text div contenteditable (same
// approach as log entries) so its width, font and wrapping can't change.
function editNextItem(textEl, idx, currentText, clickEvent){
  var offset = clickEvent ? textOffsetFromPoint(textEl, clickEvent.clientX, clickEvent.clientY) : null;
  textEl.contentEditable = 'plaintext-only';
  textEl.classList.add('editing');
  if(offset !== null) placeCaretAtOffset(textEl, offset); else placeCaretAtEnd(textEl);

  var settled = false;
  function finish(){
    textEl.contentEditable = 'false';
    textEl.removeAttribute('contenteditable');
    textEl.classList.remove('editing');
    textEl.removeEventListener('keydown', onKey);
    textEl.removeEventListener('blur', commit);
    offEnter();
  }
  function commit(){
    if(settled) return;
    settled = true;
    var newText = contentEditableToText(textEl).replace(/\s*\n\s*/g, ' ').trim();
    finish();
    if(newText === currentText){
      textEl.textContent = currentText;
      return;
    }
    api.edit_next(idx, newText).then(function(items){
      nextItems = items;
      renderNextList();
    });
  }
  function onKey(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(e.key === 'Escape'){
      e.preventDefault();
      settled = true;
      finish();
      textEl.textContent = currentText;
    }
  }
  var offEnter = onEnter(textEl, commit);
  textEl.addEventListener('keydown', onKey);
  textEl.addEventListener('blur', commit);
}

var nextInput = document.getElementById('next-input');
onEnter(nextInput, function(){
  var text = nextInput.value.trim();
  if(!text) return;
  api.add_next(text).then(function(items){
    nextItems = items;
    renderNextList();
    renderCalendar();
  });
  nextInput.value = '';
});

/* ---------------- log entries ---------------- */

function findGroup(hour){
  return dayData.entries.filter(function(g){ return g.hour === hour; })[0];
}

function makeLiveSlot(group){
  var div = document.createElement('div');
  div.className = 'live-slot';
  div.setAttribute('data-hour', group.hour);
  div.contentEditable = 'true';
  var timer = null;
  var composing = false;
  // set right before we remove this element from the DOM ourselves (Enter),
  // so the synthetic 'blur' that removal triggers doesn't re-commit the same text.
  var settled = false;

  div.addEventListener('compositionstart', function(){ composing = true; });
  div.addEventListener('compositionend', function(){ composing = false; });

  function planned(text){ return div.getAttribute('data-plan') === '1' ? PLAN_PREFIX + text : text; }

  function commitAndContinue(){
    var text = contentEditableToText(div).trim();
    if(!text) return;
    settled = true;
    group.items.push(planned(text));
    renderEntries();
    scheduleSave();
    var fresh = document.querySelector('.live-slot[data-hour="'+group.hour+'"]');
    if(fresh) fresh.focus();
  }

  div.addEventListener('keydown', function(e){
    if(handleTagSuggestKeydown(e, div)) return;
    if(e.key === 'Enter' && !e.shiftKey && !composing && e.keyCode !== 229){
      e.preventDefault();
      if(timer) clearTimeout(timer);
      commitAndContinue();
      return;
    }
    handleVerticalNav(e, div, group.hour, 'live', null, composing);
  });
  div.addEventListener('input', function(){
    if(timer) clearTimeout(timer);
    timer = setTimeout(function(){ scheduleSave(); }, 600);
    if(!composing) checkTagAutocomplete(div);
  });
  div.addEventListener('blur', function(){
    closeTagSuggest();
    if(settled) return;
    settled = true;
    if(timer) clearTimeout(timer);
    var text = contentEditableToText(div).trim();
    // skip the re-render when there's nothing to commit: a no-op render here
    // would tear out whatever element focus is moving to (e.g. during
    // arrow-key navigation into another entry) before it finishes focusing.
    if(!text) return;
    group.items.push(planned(text));
    renderEntries();
    scheduleSave();
  });
  return div;
}

function openEditable(el, group, idx, caretPos){
  var div = document.createElement('div');
  div.className = 'edit-textarea';
  div.contentEditable = 'true';
  div.textContent = group.items[idx];

  // Swapping the rendered item for this raw-text box must not move any line:
  // keep the item's height, and for plain (untagged) items keep the auto-indent
  // that alignPlainLines gave them. Tagged items show "#tag" as plain text
  // instead of a pill, so their first line's text inherently starts further left.
  var itemHeight = el.getBoundingClientRect().height;
  var plainLine = el.querySelector('.plain-line');
  var indent = (plainLine && !el.querySelector('.tagged-line')) ? parseFloat(plainLine.style.paddingLeft) || 0 : 0;
  el.replaceWith(div);
  // border-box (global): min-height includes padding; width matches .entry-item,
  // whose -4px side margins make it 8px wider than its container, so wrapping
  // is identical in both states.
  div.style.minHeight = itemHeight + 'px';
  div.style.width = 'calc(100% + 8px)';
  if(indent) div.style.paddingLeft = (parseFloat(getComputedStyle(div).paddingLeft) + indent) + 'px';

  if(caretPos === 'start') placeCaretAtStart(div);
  else if(typeof caretPos === 'number') placeCaretAtOffset(div, caretPos);
  else placeCaretAtEnd(div);

  var composing = false;
  var settled = false;
  div.addEventListener('compositionstart', function(){ composing = true; });
  div.addEventListener('compositionend', function(){ composing = false; });

  function commitEdit(){
    if(settled) return;
    settled = true;
    var newText = contentEditableToText(div).trim();
    // unchanged: revert just this one div back to static display instead of
    // a full renderEntries(), which would tear out whatever element focus
    // is moving to (e.g. arrow-key navigation into another entry)
    if(newText === group.items[idx]){
      if(div.isConnected){
        var rebuilt = buildEntryItemEl(group, newText, idx);
        div.replaceWith(rebuilt);
        // The bare item has no tag-column / plain-line alignment yet; re-apply
        // it for the hour block, a frame later like renderEntries() does.
        requestAnimationFrame(function(){
          var block = rebuilt.closest('.log-block');
          if(block) alignPlainLines(block);
        });
      }
      return;
    }
    if(!newText){
      group.items.splice(idx, 1);
    } else {
      group.items[idx] = newText;
    }
    renderEntries();
    scheduleSave();
  }

  div.addEventListener('keydown', function(e){
    if(handleTagSuggestKeydown(e, div)) return;
    if(e.key === 'Enter' && !e.shiftKey && !composing && e.keyCode !== 229){
      e.preventDefault();
      settled = true;
      var parts = splitAtCaret(div);
      var before = parts[0].trim();
      var after = parts[1].replace(/^\n+/, '');
      group.items[idx] = before;
      group.items.splice(idx+1, 0, after);
      renderEntries();
      scheduleSave();
      focusEditableAt(group.hour, idx+1);
      return;
    }
    handleVerticalNav(e, div, group.hour, 'item', idx, composing);
  });
  div.addEventListener('input', function(){
    if(!composing) checkTagAutocomplete(div);
  });
  div.addEventListener('blur', function(){
    closeTagSuggest();
    commitEdit();
  });
}

function makeItemEditable(itemEl, group, idx, clickEvent){
  var caretPos = 'end';
  if(clickEvent){
    var offset = textOffsetFromPoint(itemEl, clickEvent.clientX, clickEvent.clientY);
    if(offset !== null) caretPos = offset;
  }
  openEditable(itemEl, group, idx, caretPos);
}

function focusEditableAt(hour, idx, caretPos){
  var el = document.querySelector('.entry-item[data-hour="'+hour+'"][data-idx="'+idx+'"]');
  var group = findGroup(hour);
  if(!el || !group) return;
  openEditable(el, group, idx, caretPos || 'start');
}

function buildEntryItemEl(g, itemText, idx){
  var contentEl = document.createElement('div');
  contentEl.className = 'entry-item';
  contentEl.setAttribute('data-hour', g.hour);
  contentEl.setAttribute('data-idx', idx);
  contentEl.innerHTML = renderEntryContent(itemText, selectedDate);
  contentEl.addEventListener('click', function(e){
    var pill = e.target.closest('.tag-pill-inline');
    if(pill && pill.hasAttribute('data-tag')){
      e.stopPropagation();
      openTagSearch(pill.getAttribute('data-tag'));
      return;
    }
    makeItemEditable(contentEl, g, idx, e);
  });
  return contentEl;
}


function renderEntries(){
  var list = document.getElementById('entry-list');
  list.innerHTML = '';
  // 예정 only makes sense from today on
  var pastDay = selectedDate < todayIso();

  dayData.entries.forEach(function(g){
    var block = document.createElement('div');
    block.className = 'log-block';
    var timeEl = document.createElement('div');
    timeEl.className = 'log-hour';
    timeEl.textContent = g.hour;
    block.appendChild(timeEl);

    g.items.forEach(function(itemText, idx){
      block.appendChild(buildEntryItemEl(g, itemText, idx));
    });

    var slot = makeLiveSlot(g);
    var chip = document.createElement('span');
    chip.className = 'plan-chip';
    chip.textContent = '예정';
    chip.title = '예정으로 입력';

    // keep focus in the line being typed
    chip.addEventListener('mousedown', function(e){ e.preventDefault(); });
    chip.addEventListener('click', function(){
      var on = slot.getAttribute('data-plan') === '1';
      if(on) slot.removeAttribute('data-plan'); else slot.setAttribute('data-plan', '1');
      chip.classList.toggle('on', !on);
      slot.focus();
    });
    block.appendChild(slot);
    if(!pastDay) block.appendChild(chip);
    list.appendChild(block);
  });

  renderAddHourSelect();

  // Deferred to its own animation frame: forcing a layout read (inside
  // alignPlainLines) synchronously in the middle of a blur/focus transition
  // was interfering with that transition and leaving the just-typed line
  // unstyled. Reading layout a frame later avoids that.
  requestAnimationFrame(function(){
    list.querySelectorAll('.log-block').forEach(function(block){
      alignPlainLines(block);
    });
  });
}

// Tag slots are widened to match the widest tag badge in the block so every
// tagged line's text starts at the same x. Plain (untagged) lines and the
// continuation lines of an entry are NOT indented to match: they start at the
// left margin, so text can be written from the very front.
function alignPlainLines(block){
  var pills = block.querySelectorAll('.tag-slot > .tag-pill-inline');
  var maxWidth = 0;
  pills.forEach(function(p){
    var w = p.getBoundingClientRect().width;
    if(w > maxWidth) maxWidth = w;
  });
  block.querySelectorAll('.tag-slot').forEach(function(slot){
    slot.style.width = maxWidth ? Math.ceil(maxWidth) + 'px' : '';
  });
  block.querySelectorAll('.plain-line').forEach(function(line){
    line.style.paddingLeft = '';
  });
}

function renderAddHourSelect(){
  var row = document.getElementById('add-hour-row');
  var select = document.getElementById('add-hour-select');
  var existing = {};
  dayData.entries.forEach(function(g){ existing[g.hour] = true; });
  var html = '<option value="" selected disabled>+ 시간대 추가</option>';
  var any = false;
  for(var h=0; h<24; h++){
    var hourStr = pad(h)+':00';
    if(existing[hourStr]) continue;
    any = true;
    html += '<option value="'+hourStr+'">'+hourStr+'</option>';
  }
  select.innerHTML = html;
  select.value = '';
  row.style.display = any ? '' : 'none';
}

document.getElementById('add-hour-select').addEventListener('change', function(){
  var hour = this.value;
  if(!hour) return;
  var group = {hour: hour, items: []};
  dayData.entries.push(group);
  dayData.entries.sort(function(a,b){ return a.hour.localeCompare(b.hour); });
  renderEntries();
  var slot = document.querySelector('.live-slot[data-hour="'+hour+'"]');
  if(slot) slot.focus();
});


/* ---------------- search: text, #tag, and next items ---------------- */

var searchState = null; // { query, mode: 'week'|'month'|'all', anchor: Date, exactTag }
var searchSeq = 0;      // bumped per request so stale responses are dropped
var searchTimer = null;
var searchComposing = false;
var knownTags = {};     // tag name -> true, from list_tags()

function startOfWeek(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()); }
function endOfWeek(d){ var s = startOfWeek(d); return new Date(s.getFullYear(), s.getMonth(), s.getDate()+6); }

function currentSearchRange(){
  if(searchState.mode === 'all') return { startIso: null, endIso: null };
  var a = searchState.anchor;
  if(searchState.mode === 'week'){
    return { startIso: isoDate(startOfWeek(a)), endIso: isoDate(endOfWeek(a)) };
  }
  var s = new Date(a.getFullYear(), a.getMonth(), 1);
  var e = new Date(a.getFullYear(), a.getMonth()+1, 0);
  return { startIso: isoDate(s), endIso: isoDate(e) };
}

// "#name" is an exact-tag search only when it names a tag that exists (or was
// just picked from a pill/chip); otherwise it's plain text, so a half-typed
// "#콘" still finds "#콘텐츠".
function parseSearchQuery(){
  var q = searchState.query.trim();
  if(!q) return { kind: 'empty' };
  var m = q.match(/^#([\w가-힣]+)$/);
  if(m && (searchState.exactTag === m[1] || knownTags[m[1]] || (m[1] in tagColorMap))){
    return { kind: 'tag', tag: m[1] };
  }
  return { kind: 'text', text: q };
}

function openSearch(query, mode, exactTag){
  closeRecur();
  closeTagSuggest();
  searchState = { query: query || '', mode: mode || 'all', anchor: isoToDate(selectedDate), exactTag: exactTag || null };
  var input = document.getElementById('search-input');
  input.value = searchState.query;
  renderSearchUI();
  api.list_tags().then(function(tags){
    knownTags = {};
    (tags || []).forEach(function(t){ knownTags[t.tag] = true; });
  });
  runSearch();
  input.focus();
}

function openTagSearch(tag){ openSearch('#' + tag, 'week', tag); }

function setSearchQuery(query, exactTag){
  var input = document.getElementById('search-input');
  input.value = query;
  searchState.query = query;
  searchState.exactTag = exactTag || null;
  runSearch();
  input.focus();
}

function closeSearch(){
  if(!searchState) return;
  searchState = null;
  searchSeq++;
  clearTimeout(searchTimer);
  document.getElementById('search-input').blur();
  document.getElementById('search-header-left').style.display = 'none';
  document.getElementById('search-header-right').style.display = 'none';
  document.getElementById('normal-header-left').style.display = '';
  document.getElementById('normal-header-right').style.display = 'flex';
  document.getElementById('search-results').style.display = 'none';
  document.querySelectorAll('#main .acc-section').forEach(function(s){ s.style.display = ''; });
}

function renderSearchUI(){
  document.getElementById('normal-header-left').style.display = 'none';
  document.getElementById('normal-header-right').style.display = 'none';
  document.getElementById('search-header-left').style.display = '';
  document.getElementById('search-header-right').style.display = 'flex';
  document.getElementById('search-results').style.display = '';
  document.querySelectorAll('#main .acc-section').forEach(function(s){ s.style.display = 'none'; });

  document.querySelectorAll('#period-toggle .period-btn').forEach(function(btn){
    btn.classList.toggle('active', btn.getAttribute('data-period') === searchState.mode);
  });

  var all = searchState.mode === 'all';
  document.getElementById('search-nav').style.display = all ? 'none' : 'flex';
  if(!all){
    var range = currentSearchRange();
    var label = searchState.mode === 'week'
      ? shortDate(range.startIso) + ' – ' + shortDate(range.endIso)
      : searchState.anchor.getFullYear() + '년 ' + (searchState.anchor.getMonth()+1) + '월';
    document.getElementById('search-range-label').textContent = label;
  }
}

function scheduleSearch(){
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 250);
}

function runSearch(){
  if(!searchState) return;
  clearTimeout(searchTimer);
  searchState.query = document.getElementById('search-input').value;
  var parsed = parseSearchQuery();
  var range = currentSearchRange();
  var seq = ++searchSeq;
  function fresh(){ return searchState && seq === searchSeq; }

  if(parsed.kind === 'empty'){
    api.list_tags().then(function(tags){ if(fresh()) renderTagPanel(tags || []); });
  } else if(parsed.kind === 'tag'){
    api.search_tag(parsed.tag, range.startIso, range.endIso).then(function(matches){
      if(fresh()) renderSearchResults({ entries: matches || [], next: [] }, parsed);
    });
  } else {
    api.search_text(parsed.text, range.startIso, range.endIso).then(function(res){
      if(fresh()) renderSearchResults(res || { entries: [], next: [] }, parsed);
    });
  }
}

function renderTagPanel(tags){
  knownTags = {};
  tags.forEach(function(t){ knownTags[t.tag] = true; });
  var box = document.getElementById('search-results');
  box.innerHTML = '';
  var hint = document.createElement('div');
  hint.className = 'search-hint';
  hint.textContent = tags.length ? '기록과 할 일에서 찾아요. 태그를 눌러 바로 볼 수도 있어요.' : '기록과 할 일에서 찾아요. 아직 쓴 태그가 없어요.';
  box.appendChild(hint);
  if(!tags.length) return;
  var wrap = document.createElement('div');
  wrap.className = 'tag-chip-row';
  tags.forEach(function(t){
    var c = tagColor(t.tag);
    var chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.style.background = c.bg;
    chip.style.color = c.text;
    chip.textContent = '#' + t.tag + ' ';
    var n = document.createElement('span');
    n.className = 'tag-chip-count';
    n.textContent = t.count;
    chip.appendChild(n);
    chip.addEventListener('click', function(){ setSearchQuery('#' + t.tag, t.tag); });
    wrap.appendChild(chip);
  });
  box.appendChild(wrap);
}

function highlightMatches(root, needle){
  var lower = needle.toLowerCase();
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  var nodes = [];
  var n;
  while((n = walker.nextNode())) nodes.push(n);
  nodes.forEach(function(node){
    var text = node.data, low = text.toLowerCase();
    var idx = low.indexOf(lower);
    if(idx === -1) return;
    var frag = document.createDocumentFragment();
    var pos = 0;
    while(idx !== -1){
      if(idx > pos) frag.appendChild(document.createTextNode(text.slice(pos, idx)));
      var mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.textContent = text.slice(idx, idx + needle.length);
      frag.appendChild(mark);
      pos = idx + needle.length;
      idx = low.indexOf(lower, pos);
    }
    if(pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    node.parentNode.replaceChild(frag, node);
  });
}

function renderSearchResults(res, parsed){
  var box = document.getElementById('search-results');
  box.innerHTML = '';
  var entries = res.entries || [];
  var nexts = res.next || [];
  if(!entries.length && !nexts.length){
    var empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = parsed.kind === 'tag'
      ? '이 기간에는 해당 태그 기록이 없어요.'
      : (searchState.mode === 'all' ? '검색 결과가 없어요.' : '이 기간에는 검색 결과가 없어요.');
    box.appendChild(empty);
    return;
  }

  var byDate = {};
  var order = [];
  entries.forEach(function(m){
    if(!byDate[m.date]){ byDate[m.date] = []; order.push(m.date); }
    byDate[m.date].push(m);
  });
  if(searchState.mode === 'all') order.reverse(); // newest first when browsing all history

  var parts = [];
  if(entries.length) parts.push(order.length + '일 · 기록 ' + entries.length + '개');
  if(nexts.length) parts.push('할 일 ' + nexts.length + '개');
  var summary = document.createElement('div');
  summary.className = 'search-summary';
  summary.textContent = parts.join(' · ');
  box.appendChild(summary);

  function hl(el){ if(parsed.kind === 'text') highlightMatches(el, parsed.text); }

  if(nexts.length){
    var ng = document.createElement('div');
    ng.className = 'search-group';
    var nl = document.createElement('div');
    nl.className = 'search-date-label static';
    nl.textContent = 'next';
    ng.appendChild(nl);
    nexts.forEach(function(it){
      var row = document.createElement('div');
      row.className = 'entry-item next-result' + (it.done ? ' done' : '');
      var t = document.createElement('div');
      t.className = 'next-result-text';
      t.textContent = it.text;
      hl(t);
      var meta = document.createElement('div');
      meta.className = 'next-meta';
      meta.textContent = it.done
        ? shortDate(it.added) + ' → ' + shortDate(it.doneDate || it.added)
        : shortDate(it.added);
      row.appendChild(t);
      row.appendChild(meta);
      if(it.note){
        var nt = document.createElement('div');
        nt.className = 'next-note';
        var na = document.createElement('span');
        na.className = 'note-arrow';
        na.textContent = '↳';
        var nx = document.createElement('span');
        nx.textContent = it.note;
        hl(nx);
        nt.appendChild(na);
        nt.appendChild(nx);
        row.appendChild(nt);
      }
      ng.appendChild(row);
    });
    box.appendChild(ng);
  }

  order.forEach(function(dateStr){
    var group = document.createElement('div');
    group.className = 'search-group';

    var label = document.createElement('div');
    label.className = 'search-date-label';
    label.textContent = dateLabel(dateStr);
    label.addEventListener('click', function(){ switchToDate(dateStr); });
    group.appendChild(label);

    byDate[dateStr].forEach(function(m){
      var item = document.createElement('div');
      item.className = 'entry-item';
      item.innerHTML = renderEntryContent(m.text, dateStr);
      hl(item);
      item.addEventListener('click', function(e){
        var pill = e.target.closest('.tag-pill-inline');
        if(!pill || !pill.hasAttribute('data-tag')) return;
        var tag = pill.getAttribute('data-tag');
        setSearchQuery('#' + tag, tag);
      });
      group.appendChild(item);
    });

    box.appendChild(group);
  });
}

function shiftSearchAnchor(dir){
  if(!searchState || searchState.mode === 'all') return;
  var a = searchState.anchor;
  searchState.anchor = searchState.mode === 'week'
    ? new Date(a.getFullYear(), a.getMonth(), a.getDate() + dir*7)
    : new Date(a.getFullYear(), a.getMonth() + dir, 1);
  renderSearchUI();
  runSearch();
}

var searchInput = document.getElementById('search-input');
searchInput.addEventListener('compositionstart', function(){ searchComposing = true; });
searchInput.addEventListener('compositionend', function(){ searchComposing = false; scheduleSearch(); });
searchInput.addEventListener('input', function(){
  if(!searchState) return;
  if(searchState.exactTag && searchInput.value.trim() !== '#' + searchState.exactTag) searchState.exactTag = null;
  if(!searchComposing) scheduleSearch();
});
searchInput.addEventListener('keydown', function(e){
  if(e.isComposing || e.keyCode === 229) return;
  if(e.key === 'Escape'){ e.preventDefault(); closeSearch(); }
});
onEnter(searchInput, runSearch);

document.getElementById('search-open-btn').addEventListener('click', function(){ openSearch('', 'all'); });
onActivateKey(document.getElementById('search-open-btn'), function(){ openSearch('', 'all'); });

// e.code (not e.key) so Ctrl+F also works while the Korean IME is on.
document.addEventListener('keydown', function(e){
  if(!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.code !== 'KeyF') return;
  e.preventDefault();
  if(searchState){ searchInput.focus(); searchInput.select(); }
  else openSearch('', 'all');
});

document.getElementById('search-close-btn').addEventListener('click', closeSearch);
onActivateKey(document.getElementById('search-close-btn'), closeSearch);

document.querySelectorAll('#period-toggle .period-btn').forEach(function(btn){
  function activate(){
    if(!searchState) return;
    searchState.mode = btn.getAttribute('data-period');
    renderSearchUI();
    runSearch();
  }
  btn.addEventListener('click', activate);
  onActivateKey(btn, activate);
});

document.getElementById('search-prev').addEventListener('click', function(){ shiftSearchAnchor(-1); });
document.getElementById('search-next').addEventListener('click', function(){ shiftSearchAnchor(1); });
onActivateKey(document.getElementById('search-prev'), function(){ shiftSearchAnchor(-1); });
onActivateKey(document.getElementById('search-next'), function(){ shiftSearchAnchor(1); });
/* ---------------- status ---------------- */

function renderStatus(){
  document.querySelectorAll('.status-btn').forEach(function(btn){
    var group = btn.getAttribute('data-group');
    var value = btn.getAttribute('data-value');
    var active = group === 'focus' ? dayData.focus === value : dayData.mood === value;
    btn.classList.toggle('active', active);
  });
}

function selectStatus(btn){
  var group = btn.getAttribute('data-group');
  var value = btn.getAttribute('data-value');
  if(group === 'focus') dayData.focus = (dayData.focus === value ? null : value);
  else dayData.mood = (dayData.mood === value ? null : value);
  renderStatus();
  flushSave();
}
document.querySelectorAll('.status-btn').forEach(function(btn){
  btn.addEventListener('click', function(){ selectStatus(btn); });
  onActivateKey(btn, function(){ selectStatus(btn); });
});

/* ---------------- accordion ---------------- */

document.querySelectorAll('.acc-section').forEach(function(section){
  var body = section.querySelector('.acc-body');
  var header = section.querySelector('.acc-header');
  body.style.display = section.classList.contains('open') ? '' : 'none';
  function toggle(){
    var isOpen = section.classList.toggle('open');
    body.style.display = isOpen ? '' : 'none';
    header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }
  header.addEventListener('click', toggle);
  onActivateKey(header, toggle);
});

/* ---------------- export menu ---------------- */

var menuTrigger = document.getElementById('menu-trigger');
var exportMenu = document.getElementById('export-menu');
menuTrigger.addEventListener('click', function(e){
  e.stopPropagation();
  var willOpen = exportMenu.style.display !== 'block';
  exportMenu.style.display = willOpen ? 'block' : 'none';
  menuTrigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
});
onActivateKey(menuTrigger, function(){ menuTrigger.click(); });
exportMenu.addEventListener('click', function(e){ e.stopPropagation(); });
document.addEventListener('click', function(){
  exportMenu.style.display = 'none';
  menuTrigger.setAttribute('aria-expanded', 'false');
});
document.getElementById('export-item').addEventListener('click', function(){
  flushSave();
  api.export_month(viewYear, viewMonth);
  exportMenu.style.display = 'none';
  menuTrigger.setAttribute('aria-expanded', 'false');
});

/* ---------------- delete across a multi-entry selection ---------------- */

// Character offset of a Range boundary point, measured within root's full
// rendered text (works through the tag-pill/rest-text wrapper spans since
// Range.toString() just concatenates contained text nodes).
function offsetWithin(root, container, offset){
  var r = document.createRange();
  r.selectNodeContents(root);
  r.setEnd(container, offset);
  return r.toString().length;
}

document.addEventListener('keydown', function(e){
  if(e.key !== 'Backspace' && e.key !== 'Delete') return;
  var sel = window.getSelection();
  if(!sel || sel.isCollapsed || !sel.rangeCount) return;

  var range = sel.getRangeAt(0);
  var anchorEl = range.commonAncestorContainer.nodeType === 1
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if(anchorEl && anchorEl.closest('[contenteditable="true"]')) return; // native editing handles its own selection

  var list = document.getElementById('entry-list');
  if(!anchorEl || !list.contains(anchorEl)) return;

  var items = Array.prototype.slice.call(list.querySelectorAll('.entry-item'));
  var touched = items.filter(function(el){ return sel.containsNode(el, true); });
  if(!touched.length) return;

  e.preventDefault();

  var byGroup = {};
  touched.forEach(function(el){
    var hour = el.getAttribute('data-hour');
    var idx = Number(el.getAttribute('data-idx'));
    var group = findGroup(hour);
    if(!group) return;
    var full = sel.containsNode(el, false);
    var newText = null;
    if(!full){
      var text = group.items[idx];
      var startsHere = el.contains(range.startContainer);
      var endsHere = el.contains(range.endContainer);
      var before = startsHere ? text.slice(0, offsetWithin(el, range.startContainer, range.startOffset)) : '';
      var after = endsHere ? text.slice(offsetWithin(el, range.endContainer, range.endOffset)) : '';
      newText = before + after;
    }
    (byGroup[hour] = byGroup[hour] || []).push({idx: idx, full: full, newText: newText});
  });

  Object.keys(byGroup).forEach(function(hour){
    var group = findGroup(hour);
    if(!group) return;
    var ops = byGroup[hour].sort(function(a, b){ return b.idx - a.idx; });
    ops.forEach(function(op){
      if(op.full || !op.newText){
        group.items.splice(op.idx, 1);
      } else {
        group.items[op.idx] = op.newText;
      }
    });
  });

  sel.removeAllRanges();
  renderEntries();
  scheduleSave();
});

/* ---------------- tag autocomplete ---------------- */

var tagSuggestEl = null;
var tagSuggestState = null; // { div, lineStart, caretOffset, matches, activeIndex }

function ensureTagSuggestEl(){
  if(tagSuggestEl) return tagSuggestEl;
  tagSuggestEl = document.createElement('div');
  tagSuggestEl.className = 'tag-suggest';
  document.body.appendChild(tagSuggestEl);
  return tagSuggestEl;
}

function closeTagSuggest(){
  tagSuggestState = null;
  if(tagSuggestEl) tagSuggestEl.style.display = 'none';
}

function renderTagSuggest(){
  var el = ensureTagSuggestEl();
  el.innerHTML = '';
  tagSuggestState.matches.forEach(function(tag, i){
    var c = tagColor(tag);
    var item = document.createElement('div');
    item.className = 'tag-suggest-item' + (i === tagSuggestState.activeIndex ? ' active' : '');
    item.innerHTML = '<span class="tag-pill-inline" style="background:'+c.bg+'; color:'+c.text+'">#'+tag+'</span>';
    item.addEventListener('mousedown', function(e){
      e.preventDefault(); // keep focus in the live div instead of the dropdown
      selectTagSuggest(i);
    });
    el.appendChild(item);
  });
  el.style.display = 'block';
}

function positionTagSuggest(div){
  var el = ensureTagSuggestEl();
  var rect = null;
  var sel = window.getSelection();
  if(sel.rangeCount){
    var r = sel.getRangeAt(0).cloneRange();
    r.collapse(true);
    var rects = r.getClientRects();
    if(rects.length) rect = rects[0];
  }
  if(!rect) rect = div.getBoundingClientRect();
  el.style.left = Math.round(rect.left) + 'px';
  el.style.top = Math.round(rect.bottom + 4) + 'px';
}

// Call on every 'input' in a live-slot/edit-textarea: if the text on the
// current line, from its start up to the caret, is a bare "#partial" (no
// space yet), show matching known tags to autocomplete from.
function checkTagAutocomplete(div){
  var sel = window.getSelection();
  if(!sel.rangeCount || !sel.isCollapsed){ closeTagSuggest(); return; }
  var range = sel.getRangeAt(0);
  var caretOffset = offsetWithin(div, range.startContainer, range.startOffset);
  var fullText = contentEditableToText(div);
  var beforeCaret = fullText.slice(0, caretOffset);
  var lineStart = beforeCaret.lastIndexOf('\n') + 1;
  var currentLine = beforeCaret.slice(lineStart);
  var m = currentLine.match(/^#([\w가-힣]*)$/);
  if(!m || m[1].length === 0){ closeTagSuggest(); return; }
  var partial = m[1].toLowerCase();
  var matches = Object.keys(tagColorMap).filter(function(t){
    return t.toLowerCase().indexOf(partial) === 0;
  }).slice(0, 6);
  if(!matches.length){ closeTagSuggest(); return; }
  tagSuggestState = { div: div, lineStart: lineStart, caretOffset: caretOffset, matches: matches, activeIndex: 0 };
  renderTagSuggest();
  positionTagSuggest(div);
}

function selectTagSuggest(index){
  if(!tagSuggestState) return;
  var tag = tagSuggestState.matches[index];
  var div = tagSuggestState.div;
  var fullText = contentEditableToText(div);
  var newText = fullText.slice(0, tagSuggestState.lineStart) + '#' + tag + ' ' + fullText.slice(tagSuggestState.caretOffset);
  var newCaret = tagSuggestState.lineStart + tag.length + 2;
  closeTagSuggest();
  div.textContent = newText;
  placeCaretAtOffset(div, newCaret);
}

// True if this keydown was consumed by an open suggestion dropdown (arrow
// keys move the highlight, Enter/Tab accept it, Escape dismisses it) -
// callers check this before their own Enter/arrow handling.
function handleTagSuggestKeydown(e, div){
  if(!tagSuggestState || tagSuggestState.div !== div) return false;
  if(e.key === 'ArrowDown'){
    e.preventDefault();
    tagSuggestState.activeIndex = (tagSuggestState.activeIndex + 1) % tagSuggestState.matches.length;
    renderTagSuggest();
    return true;
  }
  if(e.key === 'ArrowUp'){
    e.preventDefault();
    tagSuggestState.activeIndex = (tagSuggestState.activeIndex - 1 + tagSuggestState.matches.length) % tagSuggestState.matches.length;
    renderTagSuggest();
    return true;
  }
  if(e.key === 'Enter' || e.key === 'Tab'){
    e.preventDefault();
    selectTagSuggest(tagSuggestState.activeIndex);
    return true;
  }
  if(e.key === 'Escape'){
    e.preventDefault();
    closeTagSuggest();
    return true;
  }
  return false;
}

/* ---------------- manual save (ctrl+s) ---------------- */

var saveToastTimer = null;
function showSavedToast(){
  var el = document.getElementById('save-toast');
  el.classList.add('show');
  if(saveToastTimer) clearTimeout(saveToastTimer);
  saveToastTimer = setTimeout(function(){ el.classList.remove('show'); }, 1200);
}

document.addEventListener('keydown', function(e){
  var isSaveShortcut = (e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S');
  if(!isSaveShortcut) return;
  e.preventDefault();
  if(document.activeElement && typeof document.activeElement.blur === 'function'){
    document.activeElement.blur();
  }
  flushSave();
  showSavedToast();
});

/* ---------------- typed shortcuts: "->" → "→", "ㄴ>" → "↳" ---------------- */

var TYPED_SYMBOLS = [['->', '→'], ['ㄴ>', '↳']];

// Uses execCommand('insertText') rather than editing the text directly so the
// replacement lands on the browser's undo stack (Ctrl+Z brings the original back).
function convertTypedSymbolBeforeCaret(el){
  var isField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
  var before;
  if(isField){
    if(el.selectionStart !== el.selectionEnd) return;
    before = el.value.slice(0, el.selectionStart);
  } else {
    var sel = window.getSelection();
    if(!sel.rangeCount || !sel.isCollapsed) return;
    // Measure from the editing host's start so a symbol split across adjacent
    // text nodes (e.g. after an IME commit) is still seen as one string.
    var r = document.createRange();
    r.selectNodeContents(el);
    r.setEnd(sel.anchorNode, sel.anchorOffset);
    before = r.toString();
  }
  for(var i = 0; i < TYPED_SYMBOLS.length; i++){
    var from = TYPED_SYMBOLS[i][0], to = TYPED_SYMBOLS[i][1];
    if(before.slice(-from.length) !== from) continue;
    if(isField){
      el.setSelectionRange(el.selectionStart - from.length, el.selectionStart);
    } else {
      for(var k = 0; k < from.length; k++) sel.modify('extend', 'backward', 'character');
    }
    document.execCommand('insertText', false, to);
    return;
  }
}

document.addEventListener('input', function(e){
  var typed = e.inputType === 'insertText' || e.inputType === 'insertCompositionText';
  if(!typed || e.isComposing || !e.data || e.data.slice(-1) !== '>') return;
  var t = e.target;
  var isTextField = (t.tagName === 'INPUT' && t.type === 'text') || t.tagName === 'TEXTAREA';
  if(isTextField || t.isContentEditable) convertTypedSymbolBeforeCaret(t);
});

/* ---------------- timer ---------------- */

var timerState = { running: null, records: [], totalMinutes: 0 };

function fmtMinutes(m){
  var h = Math.floor(m / 60), r = m % 60;
  if(!h) return r + '분';
  return r ? h + '시간 ' + r + '분' : h + '시간';
}
function fmtTotal(m){ return Math.floor(m / 60) + '시간 ' + (m % 60) + '분'; }

function loadTimer(dateStr){
  api.get_timer(dateStr).then(function(s){
    if(dateStr !== selectedDate) return; // the user already moved to another day
    timerState = s;
    renderTimer();
  });
}

function startTimer(name){
  name = (name || '').trim();
  if(!name) return;
  api.timer_start(name, selectedDate).then(function(s){ timerState = s; renderTimer(); });
}

function stopTimer(){
  api.timer_stop(selectedDate).then(function(s){ timerState = s; renderTimer(); });
}

function renderTimer(){
  var body = document.getElementById('timer-body');
  body.innerHTML = '';

  // Start/stop only applies to today; other days just show their records.
  if(selectedDate === todayIso()){
    var row = document.createElement('div');
    row.className = 'tm-row';
    if(timerState.running){
      var label = document.createElement('div');
      label.className = 'tm-name';
      var dot = document.createElement('span');
      dot.className = 'tm-dot';
      var nm = document.createElement('span');
      nm.textContent = timerState.running.name;
      label.appendChild(dot);
      label.appendChild(nm);
      var stop = document.createElement('div');
      stop.className = 'tm-btn stop';
      stop.setAttribute('role', 'button');
      stop.setAttribute('tabindex', '0');
      stop.textContent = '종료';
      stop.addEventListener('click', stopTimer);
      onActivateKey(stop, stopTimer);
      row.appendChild(label);
      row.appendChild(stop);
    } else {
      var input = document.createElement('input');
      input.type = 'text';
      input.id = 'timer-input';
      input.placeholder = '기록할 이름을 쓰고 Enter  (예: 자리 비움, 점심)';
      input.autocomplete = 'off';
      input.spellcheck = false;
      onEnter(input, function(){ startTimer(input.value); });
      var start = document.createElement('div');
      start.className = 'tm-btn start';
      start.setAttribute('role', 'button');
      start.setAttribute('tabindex', '0');
      start.textContent = '시작';
      var doStart = function(){ startTimer(input.value); };
      start.addEventListener('click', doStart);
      onActivateKey(start, doStart);
      row.appendChild(input);
      row.appendChild(start);
    }
    body.appendChild(row);
  }

  timerState.records.forEach(function(r){
    var line = document.createElement('div');
    line.className = 'tm-rec';
    var range = document.createElement('span');
    range.className = 'tm-range';
    range.textContent = r.start + ' ~ ' + r.end;
    range.addEventListener('click', function(){ editTimerRange(range, r); });
    var dur = document.createElement('span');
    dur.className = 'tm-dur';
    dur.textContent = fmtMinutes(r.minutes);
    var name = document.createElement('span');
    name.className = 'tm-rec-name';
    name.textContent = r.name;
    name.addEventListener('click', function(){ editTimerName(name, r); });
    var del = document.createElement('div');
    del.className = 'tm-del';
    del.setAttribute('role', 'button');
    del.setAttribute('tabindex', '0');
    del.setAttribute('aria-label', '기록 삭제');
    del.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    var doDelete = function(){
      api.timer_delete(r.id, r.key, selectedDate).then(function(s){ timerState = s; renderTimer(); });
    };
    del.addEventListener('click', doDelete);
    onActivateKey(del, doDelete);
    line.appendChild(range);
    line.appendChild(dur);
    line.appendChild(name);
    line.appendChild(del);
    body.appendChild(line);
  });

  var total = document.createElement('div');
  total.className = 'tm-total' + (timerState.records.length ? '' : ' empty');
  total.textContent = fmtTotal(timerState.totalMinutes);
  body.appendChild(total);
}

function saveTimerEdit(r, start, end, name){
  api.timer_update(r.id, r.key, start, end, name, selectedDate).then(function(s){ timerState = s; renderTimer(); });
}

// "09:48 ~ 10:02" typed into a small input; Enter/blur saves, Esc or bad input reverts.
function editTimerRange(span, r){
  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'tm-edit-range';
  input.value = r.start + ' ~ ' + r.end;
  span.replaceWith(input);
  input.focus();
  input.select();
  var done = false;
  function finish(commit){
    if(done) return;
    done = true;
    var m = commit && input.value.match(/^\s*(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})\s*$/);
    if(m && +m[1] < 24 && +m[2] < 60 && +m[3] < 24 && +m[4] < 60){
      var s = pad(+m[1]) + ':' + m[2], e = pad(+m[3]) + ':' + m[4];
      if(s !== r.start || e !== r.end){ saveTimerEdit(r, s, e, null); return; }
    }
    renderTimer();
  }
  onEnter(input, function(){ finish(true); });
  input.addEventListener('keydown', function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(e.key === 'Escape'){ e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', function(){ finish(true); });
}

// Rename in place on the same element (contenteditable), like next-item editing.
function editTimerName(el, r){
  el.contentEditable = 'plaintext-only';
  el.classList.add('editing');
  placeCaretAtEnd(el);
  var done = false;
  function finish(commit){
    if(done) return;
    done = true;
    var name = contentEditableToText(el).replace(/\s+/g, ' ').trim();
    if(commit && name && name !== r.name){ saveTimerEdit(r, null, null, name); return; }
    renderTimer();
  }
  onEnter(el, function(){ finish(true); });
  el.addEventListener('keydown', function(e){
    if(e.isComposing || e.keyCode === 229) return;
    if(e.key === 'Escape'){ e.preventDefault(); finish(false); }
  });
  el.addEventListener('blur', function(){ finish(true); });
}

/* ---------------- clock watch ---------------- */

setInterval(function(){
  var hour = currentHourStr();
  if(selectedDate === todayIso() && hour !== currentHourWatch){
    currentHourWatch = hour;
    ensureCurrentHourGroup();
    renderEntries();
  }
  var t = todayIso();
  document.querySelectorAll('.cal-cell').forEach(function(c){
    c.classList.toggle('is-today', c.getAttribute('data-date') === t);
  });
}, 20000);

/* ---------------- init ---------------- */

function init(){
  api = window.pywebview.api;
  api.get_tag_colors().then(function(map){
    tagColorMap = map || {};
    loadMonth();
    loadDay(selectedDate);
  });
}

window.addEventListener('pywebviewready', init);

/* ---------------- recurring schedules ---------------- */

var WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
var RECUR_FREQS = [['daily', '매일'], ['weekdays', '평일'], ['weekly', '매주'], ['biweekly', '격주'], ['monthly', '매달'], ['once', '한 번만']];
var recurRules = [];
var recurForm = null;          // rule being edited (copy), or null
var recurDeleteArmed = false;

function recurEl(tag, cls, text){
  var e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text !== undefined) e.textContent = text;
  return e;
}

function recurSummary(r){
  var s;
  if(r.freq === 'daily') s = '매일';
  else if(r.freq === 'weekdays') s = '평일';
  else if(r.freq === 'weekly') s = '매주 ' + WEEKDAY_NAMES[r.weekday];
  else if(r.freq === 'biweekly') s = '격주 ' + WEEKDAY_NAMES[r.weekday];
  else if(r.freq === 'monthly') s = (r.interval > 1 ? r.interval + '개월마다 ' : '매달 ') + r.day + '일';
  else s = shortDate(r.start);
  if(r.time) s += ' · ' + r.time;
  return s;
}

function newRecurForm(){
  var now = new Date();
  return { id: '', text: '', freq: 'monthly', weekday: now.getDay(), interval: 1, day: now.getDate(),
           time: '', writeAt: 'month', start: todayIso(), end: '', next: null };
}

function openRecur(){
  closeSearch();
  closeTagSuggest();
  closeOccPopup();
  document.querySelector('#main .main-header').style.display = 'none';
  document.getElementById('search-results').style.display = 'none';
  document.querySelectorAll('#main .acc-section').forEach(function(s){ s.style.display = 'none'; });
  document.getElementById('recur-panel').style.display = '';
  recurForm = null;
  loadRecur();
}

function closeRecur(){
  var panel = document.getElementById('recur-panel');
  if(panel.style.display === 'none') return;
  panel.style.display = 'none';
  document.querySelector('#main .main-header').style.display = '';
  document.querySelectorAll('#main .acc-section').forEach(function(s){ s.style.display = ''; });
}

function loadRecur(){
  api.list_recurring().then(function(rules){
    recurRules = rules || [];
    renderRecur();
  });
}

// the day's log or the calendar may have just received auto-written entries
function refreshAfterRecurChange(){
  flushSave();
  loadMonth();
  loadDay(selectedDate);
}

function renderRecur(){
  var panel = document.getElementById('recur-panel');
  panel.innerHTML = '';

  var head = recurEl('div', 'recur-head');
  var close = recurEl('div', 'menu-trigger');
  close.setAttribute('role', 'button');
  close.setAttribute('tabindex', '0');
  close.setAttribute('aria-label', '반복 일정 닫기');
  close.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  close.addEventListener('click', closeRecur);
  onActivateKey(close, closeRecur);
  head.appendChild(close);
  head.appendChild(recurEl('span', 'recur-title', '반복 일정'));
  panel.appendChild(head);

  var body = recurEl('div', 'recur-body');
  var list = recurEl('div', 'recur-list');
  var add = recurEl('div', 'recur-add', '+ 새 반복 일정');
  add.setAttribute('role', 'button');
  add.setAttribute('tabindex', '0');
  function startNew(){ recurForm = newRecurForm(); recurDeleteArmed = false; renderRecur(); }
  add.addEventListener('click', startNew);
  onActivateKey(add, startNew);
  list.appendChild(add);

  recurRules.forEach(function(r){
    var row = recurEl('div', 'recur-item' + (recurForm && recurForm.id === r.id ? ' active' : ''));
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    var name = recurEl('div', 'recur-item-name');
    name.innerHTML = renderInlineTags(r.text.replace(/</g, '&lt;'));
    row.appendChild(name);
    row.appendChild(recurEl('div', 'recur-item-sub', recurSummary(r)));
    function pick(){
      recurForm = JSON.parse(JSON.stringify(r));
      if(!recurForm.writeAt) recurForm.writeAt = recurForm.freq === 'monthly' ? 'month' : 'day';
      recurDeleteArmed = false;
      renderRecur();
    }
    row.addEventListener('click', pick);
    onActivateKey(row, pick);
    list.appendChild(row);
  });
  if(!recurRules.length) list.appendChild(recurEl('div', 'recur-empty', '등록된 반복 일정 없음'));
  body.appendChild(list);

  var side = recurEl('div', 'recur-form-wrap');
  if(recurForm) side.appendChild(buildRecurForm());
  else side.appendChild(recurEl('div', 'recur-empty', '목록에서 고르거나 새 반복 일정을 추가'));
  body.appendChild(side);
  panel.appendChild(body);
}

function recurRow(label, content){
  var row = recurEl('div', 'recur-row');
  row.appendChild(recurEl('span', 'recur-label', label));
  var c = recurEl('div', 'recur-field');
  [].concat(content).forEach(function(x){ c.appendChild(x); });
  row.appendChild(c);
  return row;
}

function recurPills(options, current, onPick){
  var wrap = recurEl('div', 'recur-pills');
  options.forEach(function(o){
    var b = recurEl('span', 'recur-pill' + (String(o[0]) === String(current) ? ' on' : ''), o[1]);
    b.setAttribute('role', 'button');
    b.setAttribute('tabindex', '0');
    function pick(){ onPick(o[0]); }
    b.addEventListener('click', pick);
    onActivateKey(b, pick);
    wrap.appendChild(b);
  });
  return wrap;
}

function recurInput(type, value, cls, onChange){
  var i = document.createElement('input');
  i.type = type;
  i.value = value;
  i.className = 'recur-input ' + (cls || '');
  i.autocomplete = 'off';
  i.spellcheck = false;
  i.addEventListener('input', function(){ onChange(i.value); });
  return i;
}

function buildRecurForm(){
  var f = recurForm;
  var box = recurEl('div', 'recur-form');

  var title = recurEl('div', 'recur-form-title', f.id ? '반복 일정 수정' : '새 반복 일정');
  box.appendChild(title);

  box.appendChild(recurRow('내용', recurInput('text', f.text, 'wide', function(v){ f.text = v; })));
  box.appendChild(recurRow('주기', recurPills(RECUR_FREQS, f.freq, function(v){
    f.freq = v;
    if(v === 'daily' || v === 'weekdays') f.writeAt = 'day';
    renderRecur();
  })));

  if(f.freq === 'weekly' || f.freq === 'biweekly'){
    var wd = WEEKDAY_NAMES.map(function(n, i){ return [i, n]; });
    box.appendChild(recurRow('요일', recurPills(wd, f.weekday, function(v){ f.weekday = v; renderRecur(); })));
  }
  if(f.freq === 'monthly'){
    var sel = document.createElement('select');
    sel.className = 'recur-input';
    [1, 2, 3, 4, 6, 12].forEach(function(n){
      var o = document.createElement('option');
      o.value = n;
      o.textContent = n + '개월마다';
      if(n === f.interval) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function(){ f.interval = parseInt(sel.value, 10); });
    var dayIn = recurInput('number', f.day, 'num', function(v){ f.day = parseInt(v, 10) || 1; });
    dayIn.min = 1;
    dayIn.max = 31;
    box.appendChild(recurRow('날짜', [sel, dayIn, recurEl('span', 'recur-unit', '일'),
      recurEl('span', 'recur-hint', '말일을 넘는 달은 말일로 처리함')]));
  }
  if(f.freq === 'once'){
    box.appendChild(recurRow('날짜', recurInput('date', f.start, '', function(v){ f.start = v; })));
  }

  var time = document.createElement('select');
  time.className = 'recur-input';
  var none = document.createElement('option');
  none.value = '';
  none.textContent = '없음 (맨 위 시간대)';
  time.appendChild(none);
  for(var h = 0; h < 24; h++){
    var o = document.createElement('option');
    o.value = pad(h) + ':00';
    o.textContent = pad(h) + ':00';
    if(o.value === f.time) o.selected = true;
    time.appendChild(o);
  }
  time.addEventListener('change', function(){ f.time = time.value; });
  box.appendChild(recurRow('시간', [time, recurEl('span', 'recur-hint', '정하면 로그의 그 시간대에 기록됨')]));

  if(f.freq !== 'daily' && f.freq !== 'weekdays'){
    box.appendChild(recurRow('기록', [
      recurPills([['day', '당일'], ['month', '월초에 미리']], f.writeAt || 'day', function(v){ f.writeAt = v; renderRecur(); }),
      recurEl('span', 'recur-hint', f.writeAt === 'month'
        ? '월이 시작되면 그 날짜 로그에 ◇ 예정으로 미리 기록함'
        : '그 날짜가 되면 그날 로그에 기록함')
    ]));
  }

  if(f.freq !== 'once'){
    box.appendChild(recurRow('기간', [
      recurInput('date', f.start, '', function(v){ f.start = v; }),
      recurEl('span', 'recur-unit', '부터'),
      recurInput('date', f.end, '', function(v){ f.end = v; }),
      recurEl('span', 'recur-hint', '끝 날짜를 비우면 종료 없음')
    ]));
  }

  if(f.id){
    box.appendChild(recurEl('div', 'recur-next',
      '다음 회차: ' + (f.next ? dateLabel(f.next) : '없음') + ' · 회차별 날짜는 달력의 ◇에서 변경'));
  }

  var msg = recurEl('div', 'recur-msg');
  var foot = recurEl('div', 'recur-foot');
  if(f.id){
    var del = recurEl('span', 'recur-del', recurDeleteArmed ? '삭제 확인' : '이 반복 일정 삭제');
    del.setAttribute('role', 'button');
    del.setAttribute('tabindex', '0');
    function doDel(){
      if(!recurDeleteArmed){ recurDeleteArmed = true; del.textContent = '삭제 확인'; del.classList.add('armed'); return; }
      api.delete_recurring_rule(f.id).then(function(){ recurForm = null; recurDeleteArmed = false; loadRecur(); refreshAfterRecurChange(); });
    }
    del.addEventListener('click', doDel);
    onActivateKey(del, doDel);
    if(recurDeleteArmed) del.classList.add('armed');
    foot.appendChild(del);
  }
  var spacer = recurEl('span', 'recur-spacer');
  foot.appendChild(spacer);
  var cancel = recurEl('span', 'recur-cancel', '취소');
  cancel.setAttribute('role', 'button');
  cancel.setAttribute('tabindex', '0');
  function doCancel(){ recurForm = null; recurDeleteArmed = false; renderRecur(); }
  cancel.addEventListener('click', doCancel);
  onActivateKey(cancel, doCancel);
  var save = recurEl('span', 'recur-save', '저장');
  save.setAttribute('role', 'button');
  save.setAttribute('tabindex', '0');
  function doSave(){
    if(!f.text.trim()){ msg.textContent = '내용 입력 필요'; return; }
    if(f.freq !== 'once' && f.end && f.end < f.start){ msg.textContent = '끝 날짜가 시작 날짜보다 앞임'; return; }
    if(!f.start){ msg.textContent = '날짜 입력 필요'; return; }
    api.save_recurring_rule(f).then(function(res){
      if(!res || !res.ok){ msg.textContent = '저장 실패, 입력 확인 필요'; return; }
      recurForm = null;
      recurDeleteArmed = false;
      loadRecur();
      refreshAfterRecurChange();
    });
  }
  save.addEventListener('click', doSave);
  onActivateKey(save, doSave);
  foot.appendChild(cancel);
  foot.appendChild(save);
  box.appendChild(msg);
  box.appendChild(foot);
  return box;
}

document.getElementById('recur-open').addEventListener('click', openRecur);
onActivateKey(document.getElementById('recur-open'), openRecur);

/* ---- change one occurrence from the calendar ◇ ---- */

var occPopup = null;

function closeOccPopup(){
  if(occPopup){ occPopup.remove(); occPopup = null; }
}

function openOccPopup(anchor, day){
  closeOccPopup();
  var occs = monthOcc[String(day)] || [];
  if(!occs.length) return;
  var pop = recurEl('div', 'occ-pop');
  occs.forEach(function(o){
    var block = recurEl('div', 'occ-block');
    var name = recurEl('div', 'occ-name');
    name.innerHTML = renderInlineTags(o.text.replace(/</g, '&lt;'));
    block.appendChild(name);
    block.appendChild(recurEl('div', 'occ-sub',
      '이번 회차' + (o.changed ? ' · 변경됨' : '') + ' · 원래 ' + dateLabel(o.orig)));
    var row = recurEl('div', 'occ-row');
    var input = document.createElement('input');
    input.type = 'date';
    input.className = 'recur-input';
    input.value = o.date;
    input.min = todayIso();
    row.appendChild(input);
    block.appendChild(row);
    block.appendChild(recurEl('div', 'occ-hint', '이 회차만 변경됨, 다른 달은 그대로'));

    var btns = recurEl('div', 'occ-btns');
    if(o.changed){
      var undo = recurEl('span', 'recur-cancel', '원래대로');
      undo.setAttribute('role', 'button');
      undo.addEventListener('click', function(){
        api.set_occurrence_date(o.ruleId, o.orig, o.orig).then(function(){ closeOccPopup(); refreshAfterRecurChange(); });
      });
      btns.appendChild(undo);
    }
    var cancel = recurEl('span', 'recur-cancel', '취소');
    cancel.setAttribute('role', 'button');
    cancel.addEventListener('click', closeOccPopup);
    var ok = recurEl('span', 'recur-save', '확정');
    ok.setAttribute('role', 'button');
    ok.addEventListener('click', function(){
      if(!input.value || input.value < todayIso() || input.value === o.date){ closeOccPopup(); return; }
      api.set_occurrence_date(o.ruleId, o.orig, input.value).then(function(){ closeOccPopup(); refreshAfterRecurChange(); });
    });
    btns.appendChild(cancel);
    btns.appendChild(ok);
    block.appendChild(btns);
    pop.appendChild(block);
  });
  document.body.appendChild(pop);
  occPopup = pop;
  var r = anchor.getBoundingClientRect();
  var left = Math.max(8, Math.min(r.left - 20, window.innerWidth - pop.offsetWidth - 8));
  pop.style.left = left + 'px';
  pop.style.top = (r.bottom + 8) + 'px';
}

document.addEventListener('mousedown', function(e){
  if(occPopup && !occPopup.contains(e.target) && !e.target.closest('.plan-mark')) closeOccPopup();
});
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape' && occPopup) closeOccPopup();
});

})();
