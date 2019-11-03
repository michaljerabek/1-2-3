/*jslint vars: true, plusplus: true, devel: true, nomen: true, regexp: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, window */

define(function (require, exports, module) {

    "use strict";

    var FKEY = "F11",

        NS = "mjerabek-cz__1-2-3",
        TITLE = "1-2-3",

        ID = {
            initialNumberInput: NS + "__initial-number",
            stepInput: NS + "__step",
            groupsInput: NS + "__groups",
            linesAsStart: NS + "__lines-as-start",
            linesAsStartWrapper: NS + "__lines-as-start-wrapper",
            cycleAfterInput: NS + "__cycle-after",
            groupsNote: NS + "__groups-note",
            autoRemoveInput: NS + "__auto-remove",
            removeLineNumbers: NS + "__remove-line-numbers",
            ignoreLineNumbers: NS + "__ignore-line-numbers",
            reverse: NS + "__reverse",
            random: NS + "__random"
        };


    var CommandManager = brackets.getModule("command/CommandManager"),
        KeyBindingManager = brackets.getModule("command/KeyBindingManager"),
        Menus = brackets.getModule("command/Menus"),

        Dialogs = brackets.getModule("widgets/Dialogs"),

        EditorManager = brackets.getModule("editor/EditorManager");


    var Decimal = require("node_modules/decimal.js/decimal");


    var generateSequenceCommand = "mjerabek.cz.1-2-3.generate-sequence",
        generateSequenceIgnoreLinesCommand = "mjerabek.cz.1-2-3.generate-sequence-ignore-lines",
        generateSequenceWithOptionsCommand = "mjerabek.cz.1-2-3.generate-sequence-with-options",
        generateSequenceWithOptionsIgnoreLinesCommand = "mjerabek.cz.1-2-3.generate-sequence-with-options-ignore-lines",
        saveLineNumbersCommand = "mjerabek.cz.1-2-3.save-line-numbers",
        removeSavedLineNumbersCommand = "mjerabek.cz.1-2-3.remove-saved-line-numbers";


    var origin = "mjerabek.cz.1-2-3",
        originCounter = 0,

        autoRemove = false,
        ignoreSavedLineNumbers = false,
        savedLineNumbers = null;

    function shuffleArray(array) {
        for (var i = array.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = array[i];
            array[i] = array[j];
            array[j] = temp;
        }
    }

    function flattenArray(array) {

        return array.reduce(function (acc, val) {
            return acc.concat(val);
        }, []);
    }

    function groupArrayByCount(array, count, flat) {

        array = array.reduce(function (acc, val, i) {

            if ((i % count) === 0) {

                acc.push([]);
            }

            acc[acc.length - 1].push(val);

            return acc;

        }, []);

        return !flat ? array: flattenArray(array);
    }

    function groupNumbersByLines(numbers, lineNumbers) {

        lineNumbers = lineNumbers.slice(0);

        var groupedNumbers = [[]],
            lastLineNumber = lineNumbers.shift();

        numbers.forEach(function (n) {

            if (n.selection.start.line >= lastLineNumber) {

                groupedNumbers.push([]);

                lastLineNumber = lineNumbers.shift();
            }

            groupedNumbers[groupedNumbers.length - 1].push(n);
        });

        return groupedNumbers;
    }

    function getDialog(content, okBtn, cancelBtn) {

        var btns = [];

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

        if (changes && changes.length) {

            var edits = changes.map(function (change) {

                change.selection.text = change.numberText;

                return {
                    edit: change.selection
                };
            });

            editor.document.doMultipleEdits(edits, origin);

            editor.setSelections(changes.map(function (change) { return change.endSelection; }), undefined, undefined, origin);
        }
    }

    function getChangesByStep(initialNumber, step, groups, cycleAfter) {

        var decimalInitNumber = new Decimal(initialNumber),
            decimalStep = new Decimal(step),
            decimalCycleAfter = null;

        if (cycleAfter) {

            decimalCycleAfter = new Decimal(cycleAfter);
        }

        return function (n, i) {

            var decimalIndex = new Decimal(i);

            if (decimalCycleAfter) {

                decimalIndex = decimalIndex.mod(decimalCycleAfter.mul(groups).toNumber());
            }

            var seq = decimalStep.mul(Math.floor(decimalIndex.div(groups).toNumber())).toNumber(),

                text = String(decimalInitNumber.add(seq).toNumber());

            return {
                selection: n.selection,
                numberText: text
            };
        };
    }

    function getSelectionChanges(changes, order) {

        var inlineTextPositionChange = {};

        changes.sort(function (a, b) {
            return order.findIndex(function (o) { return o.selection === a.selection; }) - order.findIndex(function (o) { return o.selection === b.selection; });
        });

        return changes.map(function (n, i) {

            inlineTextPositionChange[n.selection.start.line] = inlineTextPositionChange[n.selection.start.line] || 0;

            var endSelection = {
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

        var decimalInitNumber = new Decimal(initialNumber),
            decimalStep = new Decimal(step),

            savedLines = reverse ? savedLineNumbers.slice(0).reverse(): savedLineNumbers.slice(0),
            lastLineNumber,

            stepper = -1,
            lastGroup = -1;

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

            if (linesAsStart) {

                stepper++;
            }

            var decimalStepper = new Decimal(stepper),

                seq = groups && groups > 1 ?
                    decimalStep.mul(Math.floor(decimalStepper.div(groups).toNumber())).toNumber() :
                    decimalStep.mul(stepper).toNumber(),

                text = String(decimalInitNumber.add(seq).toNumber());

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

                    numbers.sort(function (a, b) {
                        return b.length - a.length;
                    });

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

                        cycle.sort(function (a, b) {
                            return b.length - a.length;
                        });

                        return cycle;
                    });

                    numbers = flattenArray(
                        flattenArray(numbers)
                    );
                } else {

                    numbers = groupArrayByCount(numbers, options.groups, false);

                    shuffleArray(numbers);

                    numbers.sort(function (a, b) {
                        return b.length - a.length;
                    });

                    numbers = flattenArray(numbers);
                }
            }

        } else {

            if (options.linesAsStart) {

                numbers = groupNumbersByLines(numbers, savedLineNumbers);
                numbers = flattenArray(numbers.map(function (group) {

                    if (+options.groups === 1) {

                        shuffleArray(group);

                    } else {

                        group = groupArrayByCount(group, options.groups, false);

                        shuffleArray(group);

                        group.sort(function (a, b) {
                            return b.length - a.length;
                        });

                        group = flattenArray(group);
                    }

                    return group;
                }));

            } else {

                numbers = groupNumbersByLines(numbers, savedLineNumbers);

                numbers = numbers.map(function (group, g) {
                    return group.map(function (n) {
                        n.group = g;
                        return n;
                    });
                });

                shuffleArray(numbers);

                numbers = flattenArray(numbers);
            }
        }

        return numbers;
    }

    function replaceNumbers(editor, origin, numbers, options) {

        var originalOrder = Array.prototype.slice.call(numbers),
            useSavedNumbers = savedLineNumbers && !ignoreSavedLineNumbers;

        if (options.reverse) {

            numbers.reverse();
        }

        if (options.random) {

            numbers = randomizeNumbers(numbers, options, useSavedNumbers);
        }

        var changes = numbers.map(
                useSavedNumbers ? getChangesBySavedLines(options.initialNumber, options.step, options.groups, options.linesAsStart, options.reverse, options.random):
                    getChangesByStep(options.initialNumber, options.step, options.groups, options.cycle)
            );

        changes = getSelectionChanges(changes, originalOrder);

        applyChanges(editor, changes, origin);

        if (autoRemove) {

            savedLineNumbers = null;
        }

        ignoreSavedLineNumbers = false;
    }

    function getSelections(editor) {

        if (!editor) {

            return [];
        }

        var selections = editor.getSelections();

        return selections.map(function (selection) {

            var currentLineNumber = selection.start.line,
                currentLine = editor.document.getLine(currentLineNumber),

                text = currentLine.substr(selection.start.ch, selection.end.ch - selection.start.ch);

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

        var editor = EditorManager.getActiveEditor();

        if (!editor) {

            ignoreSavedLineNumbers = false;

            return false;
        }

        var numbers = getSelections(editor),

            initialNumber = numbers[0].isNumber ? numbers[0].text : 1;

        if (numbers.length < 2) {

            getMoreSelectionsDialog();

            ignoreSavedLineNumbers = false;

            return;
        }

        if (numbers.every(function (n) { return n.isNumber; }) || numbers.every(function (n) { return n.isEmpty; })) {

            replaceNumbers(editor, (origin + originCounter++), numbers, {
                initialNumber: initialNumber,
                step: 1,
                groups: 1
            });

        } else {

            var rewriteDialog = getRewriteDialog();

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

    function getOptionsDialog(initialNumber) {

        var content = `
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
                    <input id="${ID.groupsInput}" type="number" value="1" min="1" step="1" ${ savedLineNumbers && !ignoreSavedLineNumbers ? "disabled" : "" } style="max-width: 100px; display: ${savedLineNumbers && !ignoreSavedLineNumbers ? "none": "initial"}">
                </div>
                <div style="padding: 0 8px;">
                    <label for="${ID.cycleAfterInput}" style="display: ${savedLineNumbers && !ignoreSavedLineNumbers ? "none": "block"};">Cycle after (groups)</label>
                    <input id="${ID.cycleAfterInput}" type="number" value="" min="2" step="1" ${ savedLineNumbers && !ignoreSavedLineNumbers ? "disabled" : "" } style="max-width: 100px; display: ${savedLineNumbers && !ignoreSavedLineNumbers ? "none": "initial"}">
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
                ${ savedLineNumbers && !ignoreSavedLineNumbers ? `<p id="${ID.groupsNote}" style="flex-basis: 100%; padding: 16px 8px 0 8px; margin: 0;">There are saved line numbers: <a href="#" id="${ID.removeLineNumbers}">Remove</a> | <a href="#" id="${ID.ignoreLineNumbers}">Ignore</a></p>` : "" }
            </div>
        `;


        var dialog = getDialog(content, "Rewrite", "Cancel"),

            $dialogEl = dialog.getElement();

        $dialogEl.on("keyup." + NS, "input", function (event) {

            if (event.which === 13) { //enter

                $dialogEl
                    .find("[data-button-id='" + Dialogs.DIALOG_BTN_OK + "']")
                    .click();
            }
        });

        $dialogEl.on("mouseup." + NS, "input", function (event) {

            if (this.select) {

                this.select();
            }
        });

        $dialogEl.on("change." + NS, "#" + ID.reverse + ", #" + ID.random, function (event) {

            var $reverse = $dialogEl.find("#" + ID.reverse),
                $random = $dialogEl.find("#" + ID.random);

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

                var remove = $(event.target).is("#" + ID.removeLineNumbers),
                    ignore = !remove,

                    $note = $dialogEl.find("#" + ID.groupsNote),
                    $linesAsStart = $dialogEl.find("#" + ID.linesAsStartWrapper);

                $note.stop().fadeTo(200, 0, function () {
                    $note.stop().slideUp(150, function () {
                        $note.remove();
                    });
                });

                $linesAsStart.stop().fadeTo(200, 0, function () {
                    $linesAsStart.stop().slideUp(150, function () {
                        $linesAsStart.remove();
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

                    savedLineNumbers = null;
                }

                if (ignore) {

                    ignoreSavedLineNumbers = true;
                }

                return false;
            });
        }

        dialog.done(function () {
            $dialogEl.off("." + NS);
        });

        return dialog;
    }

    function getOptionsFromDialog($dialogEl) {

        var options = {
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

        var editor = EditorManager.getActiveEditor();

        if (!editor) {

            ignoreSavedLineNumbers = false;

            return false;
        }

        var numbers = getSelections(editor),

            initialNumber = numbers[0].isNumber ? numbers[0].text : 1;

        if (numbers.length < 2) {

            getMoreSelectionsDialog();

            ignoreSavedLineNumbers = false;

            return;
        }

        if (numbers.every(function (n) { return n.isNumber; }) || numbers.every(function (n) { return n.isEmpty; })) {

            var optionsDialog = getOptionsDialog(initialNumber);

            optionsDialog.done(function (btnId) {

                if (btnId === Dialogs.DIALOG_BTN_OK) {

                    var options = getOptionsFromDialog(optionsDialog.getElement());

                    replaceNumbers(editor, (origin + originCounter++), numbers, options);

                } else {

                    ignoreSavedLineNumbers = false;
                }
            });

        } else {

            var rewriteDialog = getRewriteDialog();

            rewriteDialog.done(function (btnId) {

                if (btnId === Dialogs.DIALOG_BTN_OK) {

                    var optionsDialog = getOptionsDialog(initialNumber);

                    optionsDialog.done(function (btnId) {

                        if (btnId === Dialogs.DIALOG_BTN_OK) {

                            var options = getOptionsFromDialog(optionsDialog.getElement());

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

        var editor = EditorManager.getActiveEditor();

        if (!editor) {

            return false;
        }

        var selections = editor.getSelections(),

            lineNumbers = selections.map(function (selection) {
                return selection.start.line;
            });

        lineNumbers = lineNumbers.filter(function (value, index) {
            return lineNumbers.indexOf(value) === index;
        });

        if (lineNumbers.length < 2) {

            getMoreSelectionsDialog();

            return;
        }

        var dialog = getDialog(`
            Save <a href='#' onclick='this.nextElementSibling.style.display = \"inline\"'>${lineNumbers.length}</a><span style='display: none'> (${String(lineNumbers).replace(/,/g, ", ")})</span> line numbers?
            <div style="padding: 16px 0 0 0;">
                <label for="${ID.autoRemoveInput}"><input type="checkbox" id="${ID.autoRemoveInput}" checked style="margin-top: 2px; margin-bottom: 0px;"> Remove numbers after usage.</label>
            </div>
            `,
            "Save", "Cancel"
        );

        var $dialogEl = dialog.getElement();

        $dialogEl.on("keyup." + NS, "input", function (event) {

            if (event.which === 13) { //enter

                $dialogEl
                    .find("[data-button-id='" + Dialogs.DIALOG_BTN_OK + "']")
                    .click();
            }
        });

        dialog.done(function (btnId) {

            if (btnId === Dialogs.DIALOG_BTN_OK) {

                savedLineNumbers = lineNumbers;
                autoRemove = $dialogEl.find("#" + ID.autoRemoveInput).prop("checked");
            }
        });
    }

    function execRemoveSavedLineNumbers() {

        var dialog = getDialog(
            "Remove saved line numbers?",
            "Remove", "Cancel"
        );

        dialog.done(function (btnId) {

            if (btnId === Dialogs.DIALOG_BTN_OK) {

                savedLineNumbers = null;
            }
        });
    }


    CommandManager.register("Generate number sequence", generateSequenceCommand, execGenerateSequence);
    CommandManager.register("Generate number sequence + ignore saved lines", generateSequenceIgnoreLinesCommand, execGenerateSequenceIgnoreLinesCommand);
    CommandManager.register("Open sequence generator", generateSequenceWithOptionsCommand, execGenerateSequenceWithOptions);
    CommandManager.register("Open sequence generator + ignore saved lines", generateSequenceWithOptionsIgnoreLinesCommand, execGenerateSequenceWithOptionsIgnoreLines);
    CommandManager.register("Save line numbers", saveLineNumbersCommand, execSaveLineNumbers);
    CommandManager.register("Remove saved line numbers", removeSavedLineNumbersCommand, execRemoveSavedLineNumbers);


    if (!KeyBindingManager.getKeyBindings(generateSequenceCommand).length) {

        KeyBindingManager.addBinding(generateSequenceCommand, {
            key: "Ctrl-" + FKEY
        });
    }

    if (!KeyBindingManager.getKeyBindings(generateSequenceIgnoreLinesCommand).length) {

        KeyBindingManager.addBinding(generateSequenceIgnoreLinesCommand, {
            key: "Ctrl-Shift-" + FKEY
        });
    }

    if (!KeyBindingManager.getKeyBindings(generateSequenceWithOptionsIgnoreLinesCommand).length) {

        KeyBindingManager.addBinding(generateSequenceWithOptionsIgnoreLinesCommand, {
            key: "Alt-Shift-" + FKEY
        });
    }

    if (!KeyBindingManager.getKeyBindings(generateSequenceWithOptionsCommand).length) {

        KeyBindingManager.addBinding(generateSequenceWithOptionsCommand, {
            key: "Alt-" + FKEY
        });
    }

    if (!KeyBindingManager.getKeyBindings(saveLineNumbersCommand).length) {

        KeyBindingManager.addBinding(saveLineNumbersCommand, {
            key: "Ctrl-Alt-" + FKEY
        });
    }

    if (!KeyBindingManager.getKeyBindings(removeSavedLineNumbersCommand).length) {

        KeyBindingManager.addBinding(removeSavedLineNumbersCommand, {
            key: "Ctrl-Alt-Shift-" + FKEY
        });
    }

    var editMenu = Menus.getMenu(Menus.AppMenuBar.EDIT_MENU);

    editMenu.addMenuDivider();
    editMenu.addMenuItem(generateSequenceCommand);
    editMenu.addMenuItem(generateSequenceIgnoreLinesCommand);
    editMenu.addMenuItem(generateSequenceWithOptionsCommand);
    editMenu.addMenuItem(generateSequenceWithOptionsIgnoreLinesCommand);
    editMenu.addMenuItem(saveLineNumbersCommand);
    editMenu.addMenuItem(removeSavedLineNumbersCommand);

});
