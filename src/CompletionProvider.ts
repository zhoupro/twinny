import {
  Configuration,
  CreateCompletionRequestPrompt,
  CreateCompletionResponse,
  OpenAIApi
} from 'openai'
import {
  InlineCompletionItem,
  InlineCompletionItemProvider,
  InlineCompletionList,
  Position,
  Range,
  TextDocument,
  workspace,
  StatusBarItem,
  window
} from 'vscode'

export class CompletionProvider implements InlineCompletionItemProvider {
  private statusBar: StatusBarItem
  private _debouncer: NodeJS.Timeout | undefined;
  private _debounceWait = workspace
    .getConfiguration('twinny')
    .get('debounceWait') as number
  private _contextLength = workspace
    .getConfiguration('twinny')
    .get('contextLength') as number

  constructor(statusBar: StatusBarItem) {
    this.statusBar = statusBar
  }
  private _openai: OpenAIApi = new OpenAIApi(
    new Configuration(),
    `${workspace.getConfiguration('twinny').get('server')}/${workspace
      .getConfiguration('twinny')
      .get('engine')}`
  )

  public async provideInlineCompletionItems(
    document: TextDocument,
    position: Position
  ): Promise<InlineCompletionItem[] | InlineCompletionList | null | undefined> {
    return new Promise((resolve) => {
      if (this._debouncer) {
        clearTimeout(this._debouncer)
      }

      this._debouncer = setTimeout(async () => {
        if (!workspace.getConfiguration('twinny').get('enabled')) {
          console.debug('Extension not enabled, skipping.')
          return resolve([] as InlineCompletionItem[])
        }

        const { prefix, suffix } = this.getContext(document, position)

        const prompt = `${prefix}<FILL_HERE>${suffix}`

        if (!prompt) {
          return resolve([] as InlineCompletionItem[])
        }

        this.statusBar.tooltip = 'twinny - thinking...'
        this.statusBar.text = '$(loading~spin)'

        try {
          const { data } = await this._openai.createCompletion({
            model:
              workspace.getConfiguration('twinny').get('model') ??
              '<<UNSET>>',
            prompt: prompt as CreateCompletionRequestPrompt,
            /* eslint-disable-next-line @typescript-eslint/naming-convention */
            max_tokens: workspace
              .getConfiguration('twinny')
              .get('maxTokens'),
            temperature: workspace
              .getConfiguration('twinny')
              .get('temperature'),
            stop: ['\n']
          })
          this.statusBar.text = '$(light-bulb)'
          return resolve(
            this.getInlineCompletions(data, position, document)
          )
        } catch (error) {
          this.statusBar.text = '$(alert)'
          return resolve([] as InlineCompletionItem[])
        }
      }, this._debounceWait as number)
    })
  }

  private getContext(
    document: TextDocument,
    position: Position
  ): { prefix: string; suffix: string } {
    const start = Math.max(0, position.line - this._contextLength)

    const prefix = document.getText(
      new Range(start, 0, position.line, this._contextLength)
    )
    const suffix = document.getText(
      new Range(
        position.line,
        position.character,
        position.line + this._contextLength,
        0
      )
    )

    return { prefix, suffix }
  }

  private getInlineCompletions(
    completionResponse: CreateCompletionResponse,
    position: Position,
    document: TextDocument
  ): InlineCompletionItem[] {
    const editor = window.activeTextEditor
    if (!editor) {
      return []
    }
    return (
      completionResponse.choices?.map((choice) => {
        if (position.character === 0) {
          return new InlineCompletionItem(
            choice as string,
            new Range(position, position)
          )
        }

        const charBeforeRange = new Range(
          position.translate(0, -1),
          editor.selection.start
        )

        const charBefore = document.getText(charBeforeRange)

        if (choice.charAt(0) === ' ' && charBefore === ' ') {
          choice = choice.slice(1, choice.length)
        }

        return new InlineCompletionItem(
          choice as string,
          new Range(position, position)
        )
      }) || []
    )
  }
}
