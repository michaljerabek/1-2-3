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
            cycleAfter: NS + "__cycle-after",
            groupsNote: NS + "__groups-note",
            autoRemove: NS + "__auto-remove"
        };


    var CommandManager = brackets.getModule("command/CommandManager"),
        KeyBindingManager = brackets.getModule("command/KeyBindingManager"),
        Menus = brackets.getModule("command/Menus"),

        Dialogs = brackets.getModule("widgets/Dialogs"),

        EditorManager = brackets.getModule("editor/EditorManager");


    var Decimal = require("node_modules/decimal.js/decimal");


    var generateSequenceCommand = "mjerabek.cz.1-2-3.generate-sequence",
        generateSequenceWithOptionsCommand = "mjerabek.cz.1-2-3.generate-sequence-with-options",
        saveLineNumbersCommand = "mjerabek.cz.1-2-3.save-line-numbers",
        removeSavedLineNumbersCommand = "mjerabek.cz.1-2-3.remove-saved-line-numbers";


    var origin = "mjerabek.cz.1-2-3",
        originCounter = 0,

        autoRemove = false,
        savedLineNumbers = null;


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

        var inlineTextPositionChange = {};

        return function (n, i) {

            inlineTextPositionChange[n.selection.start.line] = inlineTextPositionChange[n.selection.start.line] || 0;

            var decimalInitNumber = new Decimal(initialNumber),

                decimalStep = new Decimal(step),
                decimalIndex = new Decimal(i);

            if (cycleAfter) {

                var decimalCycleAfter = new Decimal(cycleAfter);

                decimalIndex = decimalIndex.mod(decimalCycleAfter.mul(groups).toNumber());
            }

            var seq = decimalStep.mul(Math.floor(decimalIndex.div(groups).toNumber())).toNumber(),

                text = String(decimalInitNumber.add(seq).toNumber()),

                endSelection = {
                    start: {
                        line: n.selection.start.line,
                        ch: n.selection.start.ch + inlineTextPositionChange[n.selection.start.line]
                    },
                    end: {
                        line: n.selection.end.line,
                        ch: n.selection.start.ch + text.length + inlineTextPositionChange[n.selection.start.line]
                    }
                };

            inlineTextPositionChange[n.selection.start.line] += text.length - (n.selection.end.ch - n.selection.start.ch);

            return {
                selection: n.selection,
                endSelection: endSelection,
                numberText: text
            };
        };
    }

    function getChangesBySavedLines(initialNumber, step, groups, linesAsStart) {

        var inlineTextPositionChange = {},

            savedLines = savedLineNumbers.slice(0),

            stepper = -1;

        return function (n) {

            inlineTextPositionChange[n.selection.start.line] = inlineTextPositionChange[n.selection.start.line] || 0;

            if (typeof savedLines[0] === "number" && n.selection.start.line >= savedLines[0]) {

                stepper = linesAsStart ? -1 : stepper + 1;

                savedLines.shift();
            }

            if (linesAsStart) {

                stepper++;
            }

            var decimalInitNumber = new Decimal(initialNumber),

                decimalStep = new Decimal(step),
                decimalStepper = new Decimal(stepper);

            var seq = groups && groups > 1 ?
                    decimalStep.mul(Math.floor(decimalStepper.div(groups).toNumber())).toNumber() :
                    decimalStep.mul(stepper).toNumber(),

                text = String(decimalInitNumber.add(seq).toNumber()),

                endSelection = {
                    start: {
                        line: n.selection.start.line,
                        ch: n.selection.start.ch + inlineTextPositionChange[n.selection.start.line]
                    },
                    end: {
                        line: n.selection.end.line,
                        ch: n.selection.start.ch + text.length + inlineTextPositionChange[n.selection.start.line]
                    }
                };

            inlineTextPositionChange[n.selection.start.line] += text.length - (n.selection.end.ch - n.selection.start.ch);

            return {
                selection: n.selection,
                endSelection: endSelection,
                numberText: text
            };
        };
    }

    function replaceNumbers(editor, origin, numbers, options) {

        var changes = numbers.map(
            savedLineNumbers ? getChangesBySavedLines(options.initialNumber, options.step, options.groups, options.linesAsStart):
                getChangesByStep(options.initialNumber, options.step, options.groups, options.cycle)
        );

        applyChanges(editor, changes, origin);

        if (autoRemove) {

            savedLineNumbers = null;
        }
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

            return false;
        }

        var numbers = getSelections(editor),

            initialNumber = numbers[0].isNumber ? numbers[0].text : 1;

        if (numbers.length < 2) {

            getMoreSelectionsDialog();

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
                }
            });
        }
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
                    <label for="${ID.groupsInput}" style="display: ${savedLineNumbers ? "none": "block"};">Groups of</label>
                    <input id="${ID.groupsInput}" type="number" value="1" min="1" step="1" ${ savedLineNumbers ? "disabled" : "" } style="max-width: 100px; display: ${savedLineNumbers ? "none": "initial"}">
                </div>
                <div style="padding: 0 8px;">
                    <label for="${ID.cycleAfter}" style="display: ${savedLineNumbers ? "none": "block"};">Cycle after (groups)</label>
                    <input id="${ID.cycleAfter}" type="number" value="" step="1" ${ savedLineNumbers ? "disabled" : "" } style="max-width: 100px; display: ${savedLineNumbers ? "none": "initial"}">
                </div>
                <div id="${ID.linesAsStartWrapper}" style="flex-basis: 100%; padding: 16px 8px 0 8px; display: ${savedLineNumbers ? "block": "none"};">
                    <label for="${ID.linesAsStart}"><input type="checkbox" id="${ID.linesAsStart}" style="margin-top: 2px; margin-bottom: 0px;"> Use saved line numbers to start new sequences.</label>
                </div>
                ${ savedLineNumbers ? `<p id="${ID.groupsNote}" style="flex-basis: 100%; padding: 16px 8px 0 8px; margin: 0;"><a href="#">Do not use saved line numbers (remove).</a></p>` : "" }
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

                var $note = $dialogEl.find("#" + ID.groupsNote),
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

                $dialogEl.find(["#" + ID.groupsInput, "#" + ID.cycleAfter].join(","))
                    .filter(":hidden")
                    .prop("disabled", false)
                    .css({
                        display: "initial",
                        opacity: 0
                    })
                    .stop()
                    .fadeTo(200, 1);

                $dialogEl.find("label[for='" + ID.groupsInput + "']" + ", label[for='" + ID.cycleAfter + "']")
                    .filter(":hidden")
                    .css({
                        display: "block",
                        opacity: 0
                    })
                    .stop()
                    .fadeTo(200, 1);

                savedLineNumbers = null;

                return false;
            });
        }

        dialog.done(function () {
            $dialogEl.off("." + NS);
        });

        return dialog;
    }

    function getOptionsFromDialog($dialogEl) {

        return {
            initialNumber: $dialogEl.find("#" + ID.initialNumberInput).val() || 0,
            step: $dialogEl.find("#" + ID.stepInput).val() || 1,
            groups: $dialogEl.find("#" + ID.groupsInput).val() || 1,
            cycle: $dialogEl.find("#" + ID.cycleAfter).val() || 0,
            linesAsStart: $dialogEl.find("#" + ID.linesAsStart).prop("checked")
        };
    }

    function execGenerateSequenceWithOptions() {

        var editor = EditorManager.getActiveEditor();

        if (!editor) {

            return false;
        }

        var numbers = getSelections(editor),

            initialNumber = numbers[0].isNumber ? numbers[0].text : 1;

        if (numbers.length < 2) {

            getMoreSelectionsDialog();

            return;
        }

        if (numbers.every(function (n) { return n.isNumber; }) || numbers.every(function (n) { return n.isEmpty; })) {

            var optionsDialog = getOptionsDialog(initialNumber);

            optionsDialog.done(function (btnId) {

                if (btnId === Dialogs.DIALOG_BTN_OK) {

                    var options = getOptionsFromDialog(optionsDialog.getElement());

                    replaceNumbers(editor, (origin + originCounter++), numbers, options);
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
                        }
                    });
                }
            });
        }
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
            Save <a href='#' onclick='this.nextElementSibling.style.display = \"inline\"'>${lineNumbers.length}</a><span style='display: none'> (${String(lineNumbers).replace(/,/g, ", ")})</span> lines?
            <div style="padding: 16px 0 0 0;">
                <label for="${ID.autoRemove}"><input type="checkbox" id="${ID.autoRemove}" checked style="margin-top: 2px; margin-bottom: 0px;"> Remove after usage.</label>
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
                autoRemove = $dialogEl.find("#" + ID.autoRemove).prop("checked");
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


    CommandManager.register("Generate sequence of numbers", generateSequenceCommand, execGenerateSequence);
    CommandManager.register("Open dialog to generate sequence of numbers", generateSequenceWithOptionsCommand, execGenerateSequenceWithOptions);
    CommandManager.register("Save line numbers", saveLineNumbersCommand, execSaveLineNumbers);
    CommandManager.register("Remove saved line numbers", removeSavedLineNumbersCommand, execRemoveSavedLineNumbers);


    if (!KeyBindingManager.getKeyBindings(generateSequenceCommand).length) {

        KeyBindingManager.addBinding(generateSequenceCommand, {
            key: "Ctrl-" + FKEY
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
    editMenu.addMenuItem(generateSequenceWithOptionsCommand);
    editMenu.addMenuItem(saveLineNumbersCommand);
    editMenu.addMenuItem(removeSavedLineNumbersCommand);

});
