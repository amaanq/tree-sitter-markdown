// This grammar only concerns the inline structure according to the CommonMark Spec
// (https://spec.commonmark.org/0.30/https://spec.commonmark.org/0.30/#inlines)
// For more information see README.md

// Levels used for dynmic precedence. Ideally
// n * PRECEDENCE_LEVEL_EMPHASIS > PRECEDENCE_LEVEL_LINK for any n, so maybe the
// maginuted of these values should be increased in the future
const PRECEDENCE_LEVEL_EMPHASIS = 1;
const PRECEDENCE_LEVEL_LINK = 10;
const PRECEDENCE_LEVEL_HTML = 100;
const PRECEDENCE_LEVEL_CODE_SPAN = 100;

// Punctuation characters as specified in
// https://github.github.com/gfm/#ascii-punctuation-character
const PUNCTUATION_CHARACTERS_REGEX = '!-/:-@\\[-`\\{-~';
const PUNCTUATION_CHARACTERS_ARRAY = [
    '!', '"', '#', '$', '%', '&', "'", '(', ')', '*', '+', ',', '-', '.', '/', ':', ';', '<',
    '=', '>', '?', '@', '[', '\\', ']', '^', '_', '`', '{', '|', '}', '~'
];

// (https://github.github.com/gfm/#html-blocks)
// tag names for html blocks of type 1
const HTML_TAG_NAMES_RULE_1 = ['pre', 'script', 'style'];
// tag names for html blocks of type 6
const HTML_TAG_NAMES_RULE_7 = [
    'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center',
    'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption',
    'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head',
    'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'nav',
    'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'section', 'source', 'summary', 'table',
    'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul'
];

// !!!
// Notice the call to `add_inline_rules` which generates some additional rules related to parsing
// inline contents in different contexts.
// !!!
module.exports = grammar(add_inline_rules({
    name: 'markdown_inline',

    externals: $ => [
        // An `$._error` token is never valid  and gets emmited to kill invalid parse branches. Concretely
        // this is used to decide wether a newline closes a paragraph and together and it gets emitted
        // when trying to parse the `$._trigger_error` token in `$.link_title`.
        $._error,
        $._trigger_error,

        // Opening and closing delimiters for code spans. These are sequences of one or more backticks.
        // An opening token does not mean the text after has to be a code span if there is no closing token
        $._code_span_start,
        $._code_span_close,

        // Opening and closing delimiters for emphasis.
        $._emphasis_open_star,
        $._emphasis_open_underscore,
        $._emphasis_close_star,
        $._emphasis_close_underscore,

        // For emphasis we need to tell the parser if the last character was a whitespace (or the
        // beginning of a line) or a punctuation. These tokens never actually get emitted.
        $._last_token_whitespace,
        $._last_token_punctuation,
    ],
    precedences: $ => [
        // [$._strong_emphasis_star, $._inline_element_no_star],
        [$._strong_emphasis_star_no_link, $._inline_element_no_star_no_link],
        // [$._strong_emphasis_underscore, $._inline_element_no_underscore],
        [$._strong_emphasis_underscore_no_link, $._inline_element_no_underscore_no_link],
        [$.hard_line_break, $._whitespace],
        [$.hard_line_break, $._text_inline],
        [$.hard_line_break, $._text_inline_no_star],
        [$.hard_line_break, $._text_inline_no_underscore],
        [$.hard_line_break, $._text_inline_no_link],
        [$.hard_line_break, $._text_inline_no_star_no_link],
        [$.hard_line_break, $._text_inline_no_underscore_no_link],
    ],
    // More conflicts are defined in `add_inline_rules`
    conflicts: $ => [
        [$._image_description, $._image_description_non_empty, $._text_inline],
        [$._image_description, $._image_description_non_empty, $._text_inline_no_star],
        [$._image_description, $._image_description_non_empty, $._text_inline_no_underscore],
        [$._image_shortcut_link, $._image_description],
        [$.shortcut_link, $._link_text],
        [$.link_destination, $.link_title],
        [$._link_destination_parenthesis, $.link_title],
    ],
    extras: $ => [],

    rules: {
        inline: $ => seq(optional($._last_token_whitespace), $._inline),
        
        // A lot of inlines are defined in `add_inline_rules`, including:
        //
        // * collections of inlines
        // * code spans
        // * emphasis
        // * textual content
        // 
        // This is done to reduce code duplication, as some inlines need to be parsed differently
        // depending on the context. For example inlines in ATX headings may not contain newlines.

        // A backslash escape. This can often be part of different nodes like link labels
        //
        // https://github.github.com/gfm/#backslash-escapes
        backslash_escape: $ => new RegExp('\\\\[' + PUNCTUATION_CHARACTERS_REGEX + ']'),

        // HTML entity and numeric character references.
        //
        // The regex for entity references are build from the html_entities.json file.
        //
        // https://github.github.com/gfm/#entity-and-numeric-character-references
        entity_reference: $ => html_entity_regex(),
        numeric_character_reference: $ => /&#([0-9]{1,7}|[xX][0-9a-fA-F]{1,6});/,

        code_span: $ => prec.dynamic(PRECEDENCE_LEVEL_CODE_SPAN, seq(alias($._code_span_start, $.code_span_delimiter), repeat(choice($._text, $._soft_line_break)), alias($._code_span_close, $.code_span_delimiter))),

        // Different kinds of links:
        // * inline links (https://github.github.com/gfm/#inline-link)
        // * full reference links (https://github.github.com/gfm/#full-reference-link)
        // * collapsed reference links (https://github.github.com/gfm/#collapsed-reference-link)
        // * shortcut links (https://github.github.com/gfm/#shortcut-reference-link)
        //
        // Dynamic precedence is distributed as granular as possible to help the parser decide
        // while parsing which branch is the most important.
        //
        // https://github.github.com/gfm/#links
        _link_text: $ => prec.dynamic(PRECEDENCE_LEVEL_LINK, choice(
            $._link_text_non_empty,
            seq('[', ']')
        )),
        _link_text_non_empty: $ => seq('[', alias($._inline_no_link, $.link_text), ']'),
        link_label: $ => seq('[', repeat1(choice(
            $._text_inline_no_link,
            $.backslash_escape,
            $._soft_line_break
        )), ']'),
        link_destination: $ => prec.dynamic(PRECEDENCE_LEVEL_LINK, choice(
            seq('<', repeat(choice($._text_no_angle, $.backslash_escape)), '>'),
            seq(
                choice( // first character is not a '<'
                    $._word,
                    punctuation_without($, ['<', '(', ')']),
                    $.backslash_escape,
                    $.entity_reference,
                    $.numeric_character_reference,
                    $._link_destination_parenthesis
                ),
                repeat(choice(
                    $._word,
                    punctuation_without($, ['(', ')']),
                    $.backslash_escape,
                    $.entity_reference,
                    $.numeric_character_reference,
                    $._link_destination_parenthesis
                )),
            )
        )),
        _link_destination_parenthesis: $ => seq('(', repeat(choice($._word, $.backslash_escape, $._link_destination_parenthesis)), ')'),
        _text_no_angle: $ => choice($._word, punctuation_without($, ['<', '>']), $._whitespace),
        link_title: $ => choice(
            seq('"', repeat(choice(
                $._word,
                punctuation_without($, ['"']),
                $._whitespace,
                $.backslash_escape,
                $.entity_reference,
                $.numeric_character_reference,
                seq($._soft_line_break, optional(seq($._soft_line_break, $._trigger_error)))
            )), '"'),
            seq("'", repeat(choice(
                $._word,
                punctuation_without($, ["'"]),
                $._whitespace,
                $.backslash_escape,
                $.entity_reference,
                $.numeric_character_reference,
                seq($._soft_line_break, optional(seq($._soft_line_break, $._trigger_error)))
            )), "'"),
            seq('(', repeat(choice(
                $._word,
                punctuation_without($, ['(', ')']),
                $._whitespace,
                $.backslash_escape,
                $.entity_reference,
                $.numeric_character_reference,
                seq($._soft_line_break, optional(seq($._soft_line_break, $._trigger_error)))
            )), ')'),
        ),
        shortcut_link: $ => prec.dynamic(PRECEDENCE_LEVEL_LINK, $._link_text_non_empty),
        full_reference_link: $ => prec.dynamic(2 * PRECEDENCE_LEVEL_LINK, seq(
            $._link_text,
            $.link_label
        )),
        collapsed_reference_link: $ => prec.dynamic(PRECEDENCE_LEVEL_LINK, seq(
            $._link_text,
            '[',
            ']'
        )),
        inline_link: $ => prec.dynamic(PRECEDENCE_LEVEL_LINK, seq(
            $._link_text,
            '(',
            repeat(choice($._whitespace, $._soft_line_break)),
            optional(seq(
                choice(
                    seq(
                        $.link_destination,
                        optional(seq(
                            repeat1(choice($._whitespace, $._soft_line_break)),
                            $.link_title
                        ))
                    ),
                    $.link_title,
                ),
                repeat(choice($._whitespace, $._soft_line_break)),
            )),
            ')'
        )),

        // Images work exactly like links with a '!' added in front.
        //
        // https://github.github.com/gfm/#images
        image: $ => choice(
            $._image_inline_link,
            $._image_shortcut_link,
            $._image_full_reference_link,
            $._image_collapsed_reference_link
        ),
        _image_inline_link: $ => prec.dynamic(PRECEDENCE_LEVEL_LINK, seq(
            $._image_description,
            '(',
            repeat(choice($._whitespace, $._soft_line_break)),
            optional(seq(
                choice(
                    seq(
                        $.link_destination,
                        optional(seq(
                            repeat1(choice($._whitespace, $._soft_line_break)),
                            $.link_title
                        ))
                    ),
                    $.link_title,
                ),
                repeat(choice($._whitespace, $._soft_line_break)),
            )),
            ')'
        )),
        _image_shortcut_link: $ => prec.dynamic(3 * PRECEDENCE_LEVEL_LINK, $._image_description_non_empty),
        _image_full_reference_link: $ => prec.dynamic(PRECEDENCE_LEVEL_LINK, seq($._image_description, $.link_label)),
        _image_collapsed_reference_link: $ => prec.dynamic(PRECEDENCE_LEVEL_LINK, seq($._image_description, '[', ']')),
        _image_description: $ => prec.dynamic(3 * PRECEDENCE_LEVEL_LINK, choice($._image_description_non_empty, seq('!', '[', prec(1, ']')))),
        _image_description_non_empty: $ => seq('!', '[', alias($._inline, $.image_description), prec(1, ']')),

        // Autolinks. Uri autolinks actually accept protocolls of arbitrary length which does not
        // align with the spec. This is because the binary for the grammar gets to large if done
        // otherwise as tree-sitters code generation is not very concise for this type of regex.
        //
        // Email autolinks do not match every valid email (emails normally should not be parsed
        // using regexes), but this is how they are defined in the spec.
        //
        // https://github.github.com/gfm/#autolinks
        uri_autolink: $ => /<[a-zA-Z][a-zA-Z0-9+\.\-][a-zA-Z0-9+\.\-]*:[^ \t\r\n<>]*>/,
        email_autolink: $ =>
            /<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*>/,

        // Raw html. As with html blocks we do not emit additional information as this is best done
        // by a proper html tree-sitter grammar.
        // 
        // https://github.github.com/gfm/#raw-html
        html_tag: $ => choice($._open_tag, $._closing_tag, $._html_comment, $._processing_instruction, $._declaration, $._cdata_section),
        _open_tag: $ => prec.dynamic(PRECEDENCE_LEVEL_HTML, seq('<', $._tag_name, repeat($._attribute), repeat(choice($._whitespace, $._soft_line_break)), optional('/'), '>')),
        _closing_tag: $ => prec.dynamic(PRECEDENCE_LEVEL_HTML, seq('<', '/', $._tag_name, repeat(choice($._whitespace, $._soft_line_break)), '>')),
        _tag_name: $ => seq($._word_no_digit, repeat(choice($._word_no_digit, $._digits, '-'))),
        _attribute: $ => seq(repeat1(choice($._whitespace, $._soft_line_break)), $._attribute_name, repeat(choice($._whitespace, $._soft_line_break)), '=', repeat(choice($._whitespace, $._soft_line_break)), $._attribute_value),
        _attribute_name: $ => /[a-zA-Z_:][a-zA-Z0-9_\.:\-]*/,
        _attribute_value: $ => choice(
            /[^ \t\r\n"'=<>`]+/,
            seq("'", repeat(choice($._word, $._whitespace, $._soft_line_break, punctuation_without($, ["'"]))), "'"),
            seq('"', repeat(choice($._word, $._whitespace, $._soft_line_break, punctuation_without($, ['"']))), '"'),
        ),
        _html_comment: $ => prec.dynamic(PRECEDENCE_LEVEL_HTML, seq(
            '<!--',
            optional(seq(
                choice(
                    $._word,
                    $._whitespace,
                    $._soft_line_break,
                    punctuation_without($, ['-', '>']),
                    seq(
                        '-',
                        punctuation_without($, ['>']),
                    )
                ),
                repeat(prec.right(choice(
                    $._word,
                    $._whitespace,
                    $._soft_line_break,
                    punctuation_without($, ['-']),
                    seq(
                        '-',
                        choice(
                            $._word,
                            $._whitespace,
                            $._soft_line_break,
                            punctuation_without($, ['-']),
                        )
                    )
                ))),
            )),
            '-->'
        )),
        _processing_instruction: $ => prec.dynamic(PRECEDENCE_LEVEL_HTML, seq(
            '<?',
            repeat(prec.right(choice(
                $._word,
                $._whitespace,
                $._soft_line_break,
                punctuation_without($, []),
            ))),
            '?>'
        )),
        _declaration: $ => prec.dynamic(PRECEDENCE_LEVEL_HTML, seq(
            /<![A-Z]+/,
            choice(
                $._whitespace,
                $._soft_line_break,
            ),
            repeat(prec.right(choice(
                $._word,
                $._whitespace,
                $._soft_line_break,
                punctuation_without($, ['>']),
            ))),
            '>'
        )),
        _cdata_section: $ => prec.dynamic(PRECEDENCE_LEVEL_HTML, seq(
            '<![CDATA[',
            repeat(prec.right(choice(
                $._word,
                $._whitespace,
                $._soft_line_break,
                punctuation_without($, []),
            ))),
            ']]>'
        )),

        // A hard line break.
        //
        // https://github.github.com/gfm/#hard-line-breaks
        hard_line_break: $ => seq(choice('\\', $._whitespace_ge_2), $._soft_line_break),
        _text: $ => choice($._word, punctuation_without($, []), $._whitespace),

        // Whitespace is divided into single whitespaces and multiple whitespaces as wee need this
        // information for hard line breaks.
        _whitespace_ge_2: $ => /\t| [ \t]+/,
        _whitespace: $ => seq(choice($._whitespace_ge_2, / /), optional($._last_token_whitespace)),

        // Other than whitespace we tokenize into strings of digits, punctuation characters
        // (handled by `punctuation_without`) and strings of any other characters. This way the
        // lexer does not have to many different states, which makes it a lot easier to make
        // conflicts work.
        _word: $ => choice($._word_no_digit, $._digits),
        _word_no_digit: $ => new RegExp('[^' + PUNCTUATION_CHARACTERS_REGEX + ' \\t\\n\\r0-9]+'),
        _digits: $ => /[0-9]+/,
        _soft_line_break: $ => seq(/\n|\r\n?/, optional($._last_token_whitespace)),
    },
}));

// This function adds some extra inline rules. This is done to reduce code duplication, as some
// rules may not contain newlines, characters like '*' and '_', ... depending on the context.
//
// This is by far the most ugly part of this code and should be cleaned up.
function add_inline_rules(grammar) {
    let conflicts = [];
    for (let link of [true, false]) {
        let suffix_link = link ? "" : "_no_link";
        for (let delimiter of [false, "star", "underscore"]) {
            let suffix_delimiter = delimiter ? "_no_" + delimiter : "";
            let suffix = suffix_delimiter + suffix_link;
            grammar.rules["_inline_element" + suffix] = $ => {
                let elements = [
                    $.backslash_escape,
                    $.hard_line_break,
                    $.uri_autolink,
                    $.email_autolink,
                    $['_text_inline' + suffix_delimiter + suffix_link],
                    $.entity_reference,
                    $.numeric_character_reference,
                    $.code_span,
                    $.html_tag,
                    alias($['_emphasis_star' + suffix_link], $.emphasis),
                    alias($['_strong_emphasis_star' + suffix_link], $.strong_emphasis),
                    alias($['_emphasis_underscore' + suffix_link], $.emphasis),
                    alias($['_strong_emphasis_underscore' + suffix_link], $.strong_emphasis),
                    $.image,
                    $._soft_line_break,
                ];
                if (link) {
                    elements = elements.concat([
                        $.shortcut_link,
                        $.full_reference_link,
                        $.collapsed_reference_link,
                        $.inline_link,
                    ]);
                }
                return choice(...elements);
            };
            grammar.rules["_inline" + suffix] = $ => repeat1($["_inline_element" + suffix]);
            conflicts.push(['code_span', '_text_inline' + suffix_delimiter + suffix_link]);
            if (delimiter !== "star") {
                conflicts.push(['_emphasis_star' + suffix_link, '_text_inline' + suffix_delimiter + suffix_link]);
                conflicts.push(['_emphasis_star' + suffix_link, '_strong_emphasis_star' + suffix_link, '_text_inline' + suffix_delimiter + suffix_link]);
            }
            if (delimiter !== false) {
                conflicts.push(['_strong_emphasis_' + delimiter + suffix_link, '_inline_element_no_' + delimiter]);
            }
            if (delimiter !== "underscore") {
                conflicts.push(['_emphasis_underscore' + suffix_link, '_text_inline' + suffix_delimiter + suffix_link]);
                conflicts.push(['_emphasis_underscore' + suffix_link, '_strong_emphasis_underscore' + suffix_link, '_text_inline' + suffix_delimiter + suffix_link]);
            }

            conflicts.push(['_html_comment', '_text_inline' + suffix_delimiter + suffix_link]);
            conflicts.push(['_cdata_section', '_text_inline' + suffix_delimiter + suffix_link]);
            conflicts.push(['_declaration', '_text_inline' + suffix_delimiter + suffix_link]);
            conflicts.push(['_processing_instruction', '_text_inline' + suffix_delimiter + suffix_link]);
            conflicts.push(['_closing_tag', '_text_inline' + suffix_delimiter + suffix_link]);
            conflicts.push(['_open_tag', '_text_inline' + suffix_delimiter + suffix_link]);
            conflicts.push(['_link_text_non_empty', '_text_inline' + suffix_delimiter + suffix_link]);
            conflicts.push(['_link_text', '_text_inline' + suffix_delimiter + suffix_link]);
            grammar.rules['_text_inline' + suffix_delimiter + suffix_link] = $ => {
                let elements = [
                    $._word,
                    punctuation_without($, link ? [] : ['[', ']']),
                    $._whitespace,
                    $._code_span_start,
                    '<!--',
                    /<![A-Z]+/,
                    '<?',
                    '<![CDATA[',
                ];
                if (delimiter !== "star") {
                    elements.push($._emphasis_open_star);
                }
                if (delimiter !== "underscore") {
                    elements.push($._emphasis_open_underscore);
                }
                return choice(...elements);
            }
        }
        
        grammar.rules['_emphasis_star' + suffix_link] = $ => prec.dynamic(PRECEDENCE_LEVEL_EMPHASIS, seq(alias($._emphasis_open_star, $.emphasis_delimiter), optional($._last_token_punctuation), $['_inline' + '_no_star' + suffix_link], alias($._emphasis_close_star, $.emphasis_delimiter)));
        grammar.rules['_strong_emphasis_star' + suffix_link] = $ => prec.dynamic(2 * PRECEDENCE_LEVEL_EMPHASIS, seq(alias($._emphasis_open_star, $.emphasis_delimiter), $['_emphasis_star' + suffix_link], alias($._emphasis_close_star, $.emphasis_delimiter)));
        grammar.rules['_emphasis_underscore' + suffix_link] = $ => prec.dynamic(PRECEDENCE_LEVEL_EMPHASIS, seq(alias($._emphasis_open_underscore, $.emphasis_delimiter), optional($._last_token_punctuation), $['_inline' + '_no_underscore' + suffix_link], alias($._emphasis_close_underscore, $.emphasis_delimiter)));
        grammar.rules['_strong_emphasis_underscore' + suffix_link] = $ => prec.dynamic(2 * PRECEDENCE_LEVEL_EMPHASIS, seq(alias($._emphasis_open_underscore, $.emphasis_delimiter), $['_emphasis_underscore' + suffix_link], alias($._emphasis_close_underscore, $.emphasis_delimiter)));
    }

    let old = grammar.conflicts
    grammar.conflicts = $ => {
        let cs = old($);
        for (let conflict of conflicts) {
            let c = [];
            for (let rule of conflict) {
                c.push($[rule]);
            }
            cs.push(c);
        }
        return cs;
    }
    
    return grammar;
}

// Constructs a regex that matches all html entity references.
function html_entity_regex() {
    // A file with all html entities, should be kept up to date with
    // https://html.spec.whatwg.org/multipage/entities.json
    let html_entities = require("./html_entities.json");
    let s = '&(';
    s += Object.keys(html_entities).map(name => name.substring(1, name.length - 1)).join('|');
    s += ');';
    return new RegExp(s);
}

// Returns a rule that matches all characters that count as punctuation inside markdown, besides
// a list of excluded punctuation characters. Calling this function with a empty list as the second
// argument returns a rule that matches all punctuation.
function punctuation_without($, chars) {
    return seq(choice(...PUNCTUATION_CHARACTERS_ARRAY.filter(c => !chars.includes(c))), optional($._last_token_punctuation));
}