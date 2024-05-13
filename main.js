/*jslint vars: true, plusplus: true, devel: true, nomen: true, regexp: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, window */

define(function (require, exports, module) {
    "use strict";

    const TITLE = "1-2-3";
    const NS = "mjerabek-cz__1-2-3";
    const CMD_NS = "mjerabek-cz.1-2-3";
    const PREF_NS = "mjerabek-cz.1-2-3";
    const FKEY = "F11";
    const ID = {
        initialNumberInput: NS + "__initial-number",
        stepInput: NS + "__step",
        groupsInput: NS + "__groups",
        linesAsStart: NS + "__lines-as-start",
        linesAsStartWrapper: NS + "__lines-as-start-wrapper",
        cycleAfterInput: NS + "__cycle-after",
        groupsNote: NS + "__groups-note",
        autoRemoveInput: NS + "__auto-remove",
        lineNumbers: NS + "__line-numbers",
        removeLineNumbers: NS + "__remove-line-numbers",
        ignoreLineNumbers: NS + "__ignore-line-numbers",
        showLineNumbers: NS + "__show-line-numbers",
        reverse: NS + "__reverse",
        random: NS + "__random"
    };

    const CommandManager = brackets.getModule("command/CommandManager");
    const KeyBindingManager = brackets.getModule("command/KeyBindingManager");
    const Menus = brackets.getModule("command/Menus");
    const Dialogs = brackets.getModule("widgets/Dialogs");
    const EditorManager = brackets.getModule("editor/EditorManager");
    const PreferencesManager = brackets.getModule("preferences/PreferencesManager");

    const Decimal = require("node_modules/decimal.js/decimal");
    
    const prefs = PreferencesManager.getExtensionPrefs(PREF_NS);
    const menuAppearancePref = "menu-appearance";
    const showInToolbarPref = "show-in-toolbar";

    const generateSequenceCommand = CMD_NS + ".generate-sequence";
    const generateSequenceIgnoreLinesCommand = CMD_NS + ".generate-sequence-ignore-lines";
    const generateSequenceWithOptionsCommand = CMD_NS + ".generate-sequence-with-options";
    const generateSequenceWithOptionsIgnoreLinesCommand = CMD_NS + ".generate-sequence-with-options-ignore-lines";
    const saveLineNumbersCommand = CMD_NS + ".save-line-numbers";
    const removeSavedLineNumbersCommand = CMD_NS + ".remove-saved-line-numbers";
    
    const $toolbarIcon = $("<a>");

    const origin = "mjerabek.cz.1-2-3";
    let originCounter = 0;
    let autoRemove = false;
    let ignoreSavedLineNumbers = false;
    let savedLineNumbers = null;
    
    function escapeHTML(html) {
        return typeof html !== "string" ? "":
            html.replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
    }

    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            let j = Math.floor(Math.random() * (i + 1));
            let temp = array[i];
            array[i] = array[j];
            array[j] = temp;
        }
    }

    function groupArrayByCount(array, count, flat) {
        array = array.reduce(function (acc, val, i) {
            if ((i % count) === 0) {
                acc.push([]);
            }
            acc[acc.length - 1].push(val);
            return acc;
        }, []);
        
        return !flat ? array: array.flat();
    }

    function groupNumbersByLines(numbers, lineNumbers) {
        lineNumbers = lineNumbers.slice(0);
        const groupedNumbers = [[]];
        
        let lastLineNumber = lineNumbers.shift();
        numbers.forEach(function (n) {
            if (n.selection.start.line >= lastLineNumber) {
                groupedNumbers.push([]);
                lastLineNumber = lineNumbers.shift();
            }
            groupedNumbers[groupedNumbers.length - 1].push(n);
        });
        
        return groupedNumbers;
    }
    
    function updateSavedLineNumbers(value) {
        savedLineNumbers = value;
        $toolbarIcon.trigger("savedlineschanged." + NS);
    }

    function getSavedLinesTemplate(lineNumbers, editor) {
        if (!lineNumbers?.length || !editor) return "";
        
        let notInDocAdded = false;
        const maxNumberLength = String(Math.max(lineNumbers)).length;
        const linesContent = lineNumbers.map(number => {
            const line = editor.document.getLine(number);
            if (typeof line === "string") {
                return String(number).padStart(maxNumberLength, " ") + " | " + escapeHTML(line).trim();
            }
            const notInDoc = notInDocAdded ? "": "<em>Not in the active document:</em>\n";
            notInDocAdded = true;
            return `${notInDoc}<s>${String(number).padStart(maxNumberLength, " ")}</s> |`;
        });
        return `<pre id="${ID.lineNumbers}" style="display: none; flex-grow: 1; margin: 16px 8px 0; overflow: auto; background: none; color: inherit; max-height: 10lh; white-space: pre;">${linesContent.join("\n")}</pre>`;
    }

    function addShowLineNumbersHandler($dialogEl) {
        let shown = false;
        $dialogEl.on("click." + NS, "#" + ID.showLineNumbers, function (event) {
            event.preventDefault();
            if (shown) return;
            const $lineNumbers = $dialogEl.find("#" + ID.lineNumbers);
            $lineNumbers.stop()
                .css({
                    opacity: 0
                })
                .slideDown(150, function() {
                    $lineNumbers.fadeTo(200, 1);
                });
            shown = true;
        });
    }

    function getDialog(content, okBtn, cancelBtn) {
        const btns = [];

        if (okBtn) {
            btns.push({
                className: Dialogs.DIALOG_BTN_CLASS_PRIMARY,
                id: Dialogs.DIALOG_BTN_OK,
                text: okBtn
            });
        }
        if (cancelBtn) {
            btns.push({
                className: Dialogs.DIALOG_BTN_CLASS_LEFT,
                id: Dialogs.DIALOG_BTN_CANCEL,
                text: cancelBtn
            });
        }

        return Dialogs.showModalDialog(NS, TITLE, content, btns);
    }

    function applyChanges(editor, changes, origin) {
        if (changes?.length) {
            const edits = changes.map(function (change) {
                change.selection.text = change.numberText;
                return {
                    edit: change.selection
                };
            });
            editor.document.doMultipleEdits(edits, origin);
            editor.setSelections(changes.map(change => change.endSelection), undefined, undefined, origin);
        }
    }

    function getChangesByStep(initialNumber, step, groups, cycleAfter) {
        const decimalInitNumber = new Decimal(initialNumber);
        const decimalStep = new Decimal(step);
        const decimalCycleAfter = cycleAfter ? new Decimal(cycleAfter): null;

        return function (n, i) {
            let decimalIndex = new Decimal(i);
            if (decimalCycleAfter) {
                decimalIndex = decimalIndex.mod(decimalCycleAfter.mul(groups).toNumber());
            }
            const seq = decimalStep.mul(Math.floor(decimalIndex.div(groups).toNumber())).toNumber();
            const text = String(decimalInitNumber.add(seq).toNumber());

            return {
                selection: n.selection,
                numberText: text
            };
        };
    }

    function getSelectionChanges(changes, order) {
        changes.sort(function (a, b) {
            return order.findIndex(o => o.selection === a.selection) - 
                order.findIndex(o => o.selection === b.selection);
        });

        const inlineTextPositionChange = {};
        return changes.map(function (n, i) {
            inlineTextPositionChange[n.selection.start.line] = inlineTextPositionChange[n.selection.start.line] || 0;
            const endSelection = {
                start: {
                    line: n.selection.start.line,
                    ch: n.selection.start.ch + inlineTextPositionChange[n.selection.start.line]
                },
                end: {
                    line: n.selection.end.line,
                    ch: n.selection.start.ch + n.numberText.length + inlineTextPositionChange[n.selection.start.line]
                }
            };
            inlineTextPositionChange[n.selection.start.line] += n.numberText.length - (n.selection.end.ch - n.selection.start.ch);

            return {
                selection: n.selection,
                endSelection: endSelection,
                numberText: n.numberText
            };
        });
    }

    function getChangesBySavedLines(initialNumber, step, groups, linesAsStart, reverse, random) {
        const decimalInitNumber = new Decimal(initialNumber);
        const decimalStep = new Decimal(step);
        const savedLines = reverse ? savedLineNumbers.slice(0).reverse(): savedLineNumbers.slice(0);
        let lastLineNumber;
        let stepper = -1;
        let lastGroup = -1;

        return function (n, i) {
            if (random && !linesAsStart) {
                if (lastGroup !== n.group) {
                    stepper++;
                    lastGroup = n.group;
                }
            } else {
                while (typeof savedLines[0] === "number" &&
                    ((!reverse && n.selection.start.line >= savedLines[0]) ||
                     ( reverse && n.selection.start.line <  savedLines[0]))
                ) {
                    stepper = linesAsStart ? -1: stepper + 1;
                    savedLines.shift();
                }
            }
            stepper = linesAsStart ? stepper + 1: stepper;

            const decimalStepper = new Decimal(stepper);
            const seq = groups && groups > 1 ?
                decimalStep.mul(Math.floor(decimalStepper.div(groups).toNumber())).toNumber():
                decimalStep.mul(stepper).toNumber();
            const text = String(decimalInitNumber.add(seq).toNumber());

            return {
                selection: n.selection,
                numberText: text
            };
        };
    }

    function randomizeNumbers(numbers, options, useSavedNumbers) {
        if (!useSavedNumbers) {
            if (+options.groups === 1) {
                if (options.cycle) {
                    numbers = groupArrayByCount(numbers, options.cycle, false);
                    numbers.sort((a, b) => b.length - a.length);
                    numbers = numbers.reduce(function (acc, val) {
                        shuffleArray(val);
                        return acc.concat(val);
                    }, []);
                } else {
                    shuffleArray(numbers);
                }
            } else {
                if (options.cycle) {
                    numbers = groupArrayByCount(numbers, options.groups, false);
                    numbers = groupArrayByCount(numbers, options.cycle, false);
                    numbers = numbers.map(function (cycle) {
                        shuffleArray(cycle);
                        cycle.sort((a, b) => b.length - a.length);
                        return cycle;
                    });
                    numbers = numbers.flat(2);
                } else {
                    numbers = groupArrayByCount(numbers, options.groups, false);
                    shuffleArray(numbers);
                    numbers.sort((a, b) => b.length - a.length);
                    numbers = numbers.flat();
                }
            }
        } else {
            if (options.linesAsStart) {
                numbers = groupNumbersByLines(numbers, savedLineNumbers);
                numbers = numbers.map(function (group) {
                    if (+options.groups === 1) {
                        shuffleArray(group);
                    } else {
                        group = groupArrayByCount(group, options.groups, false);
                        shuffleArray(group);
                        group.sort((a, b) => b.length - a.length);
                        group = group.flat();
                    }
                    return group;
                });
                numbers = numbers.flat();
            } else {
                numbers = groupNumbersByLines(numbers, savedLineNumbers);
                numbers = numbers.map(function (group, g) {
                    return group.map(function (n) {
                        n.group = g;
                        return n;
                    });
                });
                shuffleArray(numbers);
                numbers = numbers.flat();
            }
        }

        return numbers;
    }

    function replaceNumbers(editor, origin, numbers, options) {
        const originalOrder = Array.prototype.slice.call(numbers);
        const useSavedNumbers = savedLineNumbers && !ignoreSavedLineNumbers;

        if (options.reverse) {
            numbers.reverse();
        }
        if (options.random) {
            numbers = randomizeNumbers(numbers, options, useSavedNumbers);
        }

        let changes = numbers.map(
            useSavedNumbers ? getChangesBySavedLines(options.initialNumber, options.step, options.groups, options.linesAsStart, options.reverse, options.random):
                getChangesByStep(options.initialNumber, options.step, options.groups, options.cycle)
        );
        changes = getSelectionChanges(changes, originalOrder);
        applyChanges(editor, changes, origin);

        if (autoRemove) {
            updateSavedLineNumbers(null);
        }
        ignoreSavedLineNumbers = false;
    }

    function getSelections(editor) {
        if (!editor) return [];

        const selections = editor.getSelections();
        return selections.map(function (selection) {
            const currentLineNumber = selection.start.line;
            const currentLine = editor.document.getLine(currentLineNumber);
            const text = currentLine.substr(selection.start.ch, selection.end.ch - selection.start.ch);

            return {
                selection: selection,
                isNumber: !!text.match(/^-?[0-9.]+$/),
                isEmpty: !text.length,
                text: text
            };
        });
    }

    function getMoreSelectionsDialog() {
        return getDialog("There is only one selection so nothing will happen.", "OK");
    }

    function getRewriteDialog() {
        return getDialog(
            "Selections do not contain only numbers. Are you sure, you want to rewrite all selections?",
            "Rewrite", "Cancel"
        );
    }

    function execGenerateSequence() {
        const editor = EditorManager.getActiveEditor();
        if (!editor) {
            ignoreSavedLineNumbers = false;
            return false;
        }

        const numbers = getSelections(editor);
        const initialNumber = numbers[0].isNumber ? numbers[0].text: 1;

        if (numbers.length < 2) {
            getMoreSelectionsDialog();
            ignoreSavedLineNumbers = false;
            return;
        }

        if (numbers.every(n => n.isNumber) || numbers.every(n => n.isEmpty)) {
            replaceNumbers(editor, (origin + originCounter++), numbers, {
                initialNumber: initialNumber,
                step: 1,
                groups: 1
            });
        } else {
            const rewriteDialog = getRewriteDialog();
            rewriteDialog.done(function (btnId) {
                if (btnId === Dialogs.DIALOG_BTN_OK) {
                    replaceNumbers(editor, (origin + originCounter++), numbers, {
                        initialNumber: initialNumber,
                        step: 1,
                        groups: 1
                    });
                } else {
                    ignoreSavedLineNumbers = false;
                }
            });
        }
    }

    function execGenerateSequenceIgnoreLinesCommand() {
        ignoreSavedLineNumbers = true;
        execGenerateSequence();
    }

    function getOptionsDialog(initialNumber, okBtnText = "Generate") {
        const editor = EditorManager.getActiveEditor();
        const content = `
            <div style="display: flex; flex-wrap: wrap; margin-left: -8px; margin-right: -8px;">
                <div style="padding: 0 8px;">
                    <label for="${ID.initialNumberInput}" style="display: block;">Initial number</label>
                    <input id="${ID.initialNumberInput}" type="number" value="${initialNumber}" style="max-width: 100px;">
                </div>
                <div style="padding: 0 8px;">
                    <label for="${ID.stepInput}" style="display: block;">Step</label>
                    <input id="${ID.stepInput}" type="number" value="1" style="max-width: 100px;">
                </div>
                <div style="padding: 0 8px;">
                    <label for="${ID.groupsInput}" style="display: ${savedLineNumbers && !ignoreSavedLineNumbers ? "none": "block"};">Groups of</label>
                    <input id="${ID.groupsInput}" type="number" value="1" min="1" step="1" ${savedLineNumbers && !ignoreSavedLineNumbers ? "disabled": "" } style="max-width: 100px; display: ${savedLineNumbers && !ignoreSavedLineNumbers ? "none": "initial"}">
                </div>
                <div style="padding: 0 8px;">
                    <label for="${ID.cycleAfterInput}" style="display: ${savedLineNumbers && !ignoreSavedLineNumbers ? "none": "block"};">Cycle after (groups)</label>
                    <input id="${ID.cycleAfterInput}" type="number" value="" min="2" step="1" ${savedLineNumbers && !ignoreSavedLineNumbers ? "disabled": "" } style="max-width: 100px; display: ${savedLineNumbers && !ignoreSavedLineNumbers ? "none": "initial"}">
                </div>
                <div style="flex-basis: 100%; display: flex; flex-wrap: wrap;">
                    <div style="padding: 16px 8px 0 8px;">
                        <label for="${ID.reverse}"><input type="checkbox" id="${ID.reverse}" style="margin-top: 2px; margin-bottom: 0px;"> Reverse</label>
                    </div>
                    <div style="padding: 16px 8px 0 8px;">
                        <label for="${ID.random}"><input type="checkbox" id="${ID.random}" style="margin-top: 2px; margin-bottom: 0px;"> Random (order)</label>
                    </div>
                </div>
                <div id="${ID.linesAsStartWrapper}" style="flex-basis: 100%; padding: 16px 8px 0 8px; display: ${savedLineNumbers && !ignoreSavedLineNumbers ? "block": "none"};">
                    <label for="${ID.linesAsStart}"><input type="checkbox" id="${ID.linesAsStart}" style="margin-top: 2px; margin-bottom: 0px;"> Use saved line numbers to start new sequences.</label>
                </div>
                ${savedLineNumbers && !ignoreSavedLineNumbers ? 
                    `<p id="${ID.groupsNote}" style="flex-basis: 100%; padding: 16px 8px 0 8px; margin: 0;">
                        There are <a href='#' id="${ID.showLineNumbers}" title="Show">${savedLineNumbers.length}</a> saved line numbers: 
                        <a href="#" id="${ID.removeLineNumbers}">Remove</a> | <a href="#" id="${ID.ignoreLineNumbers}">Ignore</a>
                    </p>
                    ${getSavedLinesTemplate(savedLineNumbers, editor)}`: "" 
                }
            </div>
        `;

        const dialog = getDialog(content, okBtnText, "Cancel");
        const $dialogEl = dialog.getElement();

        addShowLineNumbersHandler($dialogEl);
        
        $dialogEl.on("keyup." + NS, "input", function (event) {
            if (event.which === 13) { //enter
                $dialogEl
                    .find("[data-button-id='" + Dialogs.DIALOG_BTN_OK + "']")
                    .click();
            }
        });

        $dialogEl.on("mouseup." + NS, "input", function (event) {
            if (this.select && window.getSelection()?.type !== "Range") {
                this.select();
            }
        });

        $dialogEl.on("change." + NS, "#" + ID.reverse + ", #" + ID.random, function (event) {
            const $reverse = $dialogEl.find("#" + ID.reverse);
            const $random = $dialogEl.find("#" + ID.random);

            if (event.target === $reverse[0]) {
                if ($reverse.prop("checked")) {
                    $random.prop("checked", false);
                }
            }
            if (event.target === $random[0]) {
                if ($random.prop("checked")) {
                    $reverse.prop("checked", false);
                }
            }
        });

        if (savedLineNumbers) {
            $dialogEl.on("change." + NS, "#" + ID.linesAsStart, function (event) {
                if (this.checked) {
                    $dialogEl.find("#" + ID.groupsInput)
                        .prop("disabled", false)
                        .css({
                            display: "initial",
                            opacity: 0
                        })
                        .stop()
                        .fadeTo(200, 1);

                    $dialogEl.find("label[for='" + ID.groupsInput + "']")
                        .css({
                            display: "block",
                            opacity: 0
                        })
                        .stop()
                        .fadeTo(200, 1);
                } else {
                    $dialogEl.find("#" + ID.groupsInput)
                        .prop("disabled", true)
                        .stop()
                        .fadeTo(200, 0, function () {
                            $(this).css({
                                display: "none"
                            });
                        });

                    $dialogEl.find("label[for='" + ID.groupsInput + "']")
                        .stop()
                        .fadeTo(200, 0, function () {
                            $(this).css({
                                display: "none"
                            });
                        });
                }
            });

            $dialogEl.on("click." + NS, "#" + ID.groupsNote + " a", function (event) {
                const remove = event.target.matches("#" + ID.removeLineNumbers);
                const ignore = event.target.matches("#" + ID.ignoreLineNumbers);
                if (!remove && !ignore) return;
                const $note = $dialogEl.find("#" + ID.groupsNote);
                const $linesAsStart = $dialogEl.find("#" + ID.linesAsStartWrapper);
                const $lineNumbers = $dialogEl.find("#" + ID.lineNumbers);
                const $allVisible = $([$note[0], $linesAsStart[0], $lineNumbers[0]]).filter(":visible");

                $allVisible.stop().fadeTo(200, 0, function () {
                    $allVisible.stop().slideUp(150, function () {
                        $allVisible.remove();
                    });
                });
                
                $linesAsStart.find("input")
                    .prop("disabled", true);

                $dialogEl.find(["#" + ID.groupsInput, "#" + ID.cycleAfterInput].join(","))
                    .filter(":hidden")
                    .prop("disabled", false)
                    .css({
                        display: "initial",
                        opacity: 0
                    })
                    .stop()
                    .fadeTo(200, 1);
                
                $dialogEl.find("label[for='" + ID.groupsInput + "']" + ", label[for='" + ID.cycleAfterInput + "']")
                    .filter(":hidden")
                    .css({
                        display: "block",
                        opacity: 0
                    })
                    .stop()
                    .fadeTo(200, 1);

                if (remove) {
                    updateSavedLineNumbers(null);
                }
                if (ignore) {
                    ignoreSavedLineNumbers = true;
                }

                return false;
            });
        }

        dialog.done(() => $dialogEl.off("." + NS));
        
        return dialog;
    }

    function getOptionsFromDialog($dialogEl) {
        const options = {
            initialNumber: $dialogEl.find("#" + ID.initialNumberInput).val() || 0,
            step: $dialogEl.find("#" + ID.stepInput).val() || 1,
            groups: $dialogEl.find("#" + ID.groupsInput).val() || 1,
            cycle: $dialogEl.find("#" + ID.cycleAfterInput).val() || 0,
            linesAsStart: $dialogEl.find("#" + ID.linesAsStart).prop("checked"),
            reverse: $dialogEl.find("#" + ID.reverse).prop("checked"),
            random: $dialogEl.find("#" + ID.random).prop("checked")
        };
        if (options.groups < 1) {
            options.groups = 1;
        }
        if (options.cycle < 1) {
            options.cycle = 0;
        }
        return options;
    }

    function execGenerateSequenceWithOptions() {
        const editor = EditorManager.getActiveEditor();
        if (!editor) {
            ignoreSavedLineNumbers = false;
            return false;
        }

        const numbers = getSelections(editor);
        const initialNumber = numbers[0].isNumber ? numbers[0].text: 1;
        
        if (numbers.length < 2) {
            getMoreSelectionsDialog();
            ignoreSavedLineNumbers = false;
            return;
        }

        if (numbers.every(n => n.isNumber) || numbers.every(n => n.isEmpty)) {
            const optionsDialog = getOptionsDialog(initialNumber);
            optionsDialog.done(function (btnId) {
                if (btnId === Dialogs.DIALOG_BTN_OK) {
                    const options = getOptionsFromDialog(optionsDialog.getElement());
                    replaceNumbers(editor, (origin + originCounter++), numbers, options);
                } else {
                    ignoreSavedLineNumbers = false;
                }
            });

        } else {
            const rewriteDialog = getRewriteDialog();
            rewriteDialog.done(function (btnId) {
                if (btnId === Dialogs.DIALOG_BTN_OK) {
                    const optionsDialog = getOptionsDialog(initialNumber, "Rewrite");
                    optionsDialog.done(function (btnId) {
                        if (btnId === Dialogs.DIALOG_BTN_OK) {
                            const options = getOptionsFromDialog(optionsDialog.getElement());
                            replaceNumbers(editor, (origin + originCounter++), numbers, options);
                        } else {
                            ignoreSavedLineNumbers = false;
                        }
                    });
                } else {
                    ignoreSavedLineNumbers = false;
                }
            });
        }
    }

    function execGenerateSequenceWithOptionsIgnoreLines() {
        ignoreSavedLineNumbers = true;
        execGenerateSequenceWithOptions();
    }

    function execSaveLineNumbers() {
        const editor = EditorManager.getActiveEditor();
        if (!editor) return false;

        const selections = editor.getSelections();

        let lineNumbers = selections.map(selection => selection.start.line);
        lineNumbers = lineNumbers.filter((value, index) => lineNumbers.indexOf(value) === index);
        if (lineNumbers.length < 2) {
            getMoreSelectionsDialog();
            return;
        }
        
        const dialog = getDialog(`
            Save <a href='#' id="${ID.showLineNumbers}" title="Show">${lineNumbers.length}</a> line numbers?
            ${getSavedLinesTemplate(lineNumbers, editor)}
            <div style="padding: 16px 0 0 0;">
                <label for="${ID.autoRemoveInput}"><input type="checkbox" id="${ID.autoRemoveInput}" checked style="margin-top: 2px; margin-bottom: 0px;"> Remove numbers after usage.</label>
            </div>`,
            "Save", "Cancel"
        );
        const $dialogEl = dialog.getElement();

        addShowLineNumbersHandler($dialogEl);
        
        $dialogEl.on("keyup." + NS, "input", function (event) {
            if (event.which === 13) { //enter
                $dialogEl
                    .find("[data-button-id='" + Dialogs.DIALOG_BTN_OK + "']")
                    .click();
            }
        });

        dialog.done(function (btnId) {
            $dialogEl.off("." + NS);
            if (btnId === Dialogs.DIALOG_BTN_OK) {
                updateSavedLineNumbers(lineNumbers);
                autoRemove = $dialogEl.find("#" + ID.autoRemoveInput).prop("checked");
            }
        });
    }

    function execRemoveSavedLineNumbers() {
        const dialog = getDialog(
            "Remove saved line numbers?",
            "Remove", "Cancel"
        );
        dialog.done(function (btnId) {
            if (btnId === Dialogs.DIALOG_BTN_OK) {
                updateSavedLineNumbers(null);
            }
        });
    }

    CommandManager.register("Generate number sequence", generateSequenceCommand, execGenerateSequence);
    CommandManager.register("Generate + ignore saved lines", generateSequenceIgnoreLinesCommand, execGenerateSequenceIgnoreLinesCommand);
    CommandManager.register("Open sequence generator", generateSequenceWithOptionsCommand, execGenerateSequenceWithOptions);
    CommandManager.register("Open + ignore saved lines", generateSequenceWithOptionsIgnoreLinesCommand, execGenerateSequenceWithOptionsIgnoreLines);
    CommandManager.register("Save line numbers", saveLineNumbersCommand, execSaveLineNumbers);
    CommandManager.register("Remove saved line numbers", removeSavedLineNumbersCommand, execRemoveSavedLineNumbers);

    KeyBindingManager.addBinding(generateSequenceCommand, {
        key: "Ctrl-" + FKEY
    });
    KeyBindingManager.addBinding(generateSequenceIgnoreLinesCommand, {
        key: "Ctrl-Shift-" + FKEY
    });
    KeyBindingManager.addBinding(generateSequenceWithOptionsCommand, {
        key: "Alt-" + FKEY
    });
    KeyBindingManager.addBinding(generateSequenceWithOptionsIgnoreLinesCommand, {
        key: "Alt-Shift-" + FKEY
    });
    KeyBindingManager.addBinding(saveLineNumbersCommand, {
        key: "Ctrl-Alt-" + FKEY
    });
    KeyBindingManager.addBinding(removeSavedLineNumbersCommand, {
        key: "Ctrl-Alt-Shift-" + FKEY
    });
        
    const menuAppearanceValues = ["submenu", "items", "none"];
    prefs.definePreference(menuAppearancePref, "String", "submenu", {
        description: "How to show commands in the Edit menu: " + menuAppearanceValues.join(", ") + ".",
        values: menuAppearanceValues
    });
    const menuAppearancePrefValue = prefs.get(menuAppearancePref);
    
    if (menuAppearancePrefValue !== "none") {
        const editMenu = Menus.getMenu(Menus.AppMenuBar.EDIT_MENU);
        let targetMenu = editMenu;
        if (menuAppearancePrefValue === "items") {
            editMenu.addMenuDivider();
        }
        if (menuAppearancePrefValue === "submenu") {
            targetMenu = editMenu.addSubMenu("Generate number sequence", "1-2-3-generate-number-sequence-submenu");
        }
        targetMenu.addMenuItem(generateSequenceCommand);
        targetMenu.addMenuItem(generateSequenceIgnoreLinesCommand);
        targetMenu.addMenuItem(generateSequenceWithOptionsCommand);
        targetMenu.addMenuItem(generateSequenceWithOptionsIgnoreLinesCommand);
        targetMenu.addMenuItem(saveLineNumbersCommand);
        targetMenu.addMenuItem(removeSavedLineNumbersCommand);
        if (menuAppearancePrefValue === "items") {
            editMenu.addMenuDivider();
        }
    }
    
    prefs.definePreference(showInToolbarPref, "Boolean", true, {
        description: "Show button in the toolbar."
    });
    const showInToolbarPrefValue = prefs.get(showInToolbarPref);
    
    if (showInToolbarPrefValue) {
        const getToolbarIconTitle = () => `1-2-3 | Open sequence generator
CTRL: Generate number sequence
CTRL+SHIFT: Generate + ignore saved lines
ALT+SHIFT: Open + ignore saved lines
CTRL+ALT: Save line numbers
CTRL+ALT+SHIFT: Remove saved line numbers${savedLineNumbers ? "\n\nLine numbers saved.": ""}`;
        
        $toolbarIcon
            .html(`
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="rgb(187, 187, 187)" overflow="visible">
                    <path d="M22.548 9l.452-2h-5.364l1.364-6h-2l-1.364 6h-5l1.364-6h-2l-1.364 6h-6.184l-.452 2h6.182l-1.364 6h-5.36l-.458 2h5.364l-1.364 6h2l1.364-6h5l-1.364 6h2l1.364-6h6.185l.451-2h-6.182l1.364-6h5.366zm-8.73 6h-5l1.364-6h5l-1.364 6z"/>
                    <circle style="display: none" cx="23" cy="3" r="3" fill="rgb(244, 176, 66)" />
                </svg>
            `)
            .attr({
                id: NS + "__toolbar-icon",
                href: "#",
                title: getToolbarIconTitle()
            })
            .css({
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
            })
            .appendTo($("#main-toolbar .buttons"));
        
        $toolbarIcon.on("savedlineschanged." + NS, function () {
            $toolbarIcon
                .attr("title", getToolbarIconTitle())
                .find("circle")
                .css("display", savedLineNumbers ? "initial": "none");
        });

        $toolbarIcon.on("click." + NS, function (event) {
            event.preventDefault();
            switch (true) {
                case event.ctrlKey && event.altKey && event.shiftKey:
                    CommandManager.execute(removeSavedLineNumbersCommand);
                    break;
                case event.ctrlKey && event.altKey:
                    CommandManager.execute(saveLineNumbersCommand);
                    break;
                case event.ctrlKey && event.shiftKey:
                    CommandManager.execute(generateSequenceIgnoreLinesCommand);
                    break;
                case event.altKey && event.shiftKey:
                    CommandManager.execute(generateSequenceWithOptionsIgnoreLinesCommand);
                    break;
                case event.ctrlKey:
                    CommandManager.execute(generateSequenceCommand);
                    break;
                case event.altKey:
                    CommandManager.execute(generateSequenceWithOptionsCommand);
                    break;
                default:
                    CommandManager.execute(generateSequenceWithOptionsCommand);
            }
        });
    }
});