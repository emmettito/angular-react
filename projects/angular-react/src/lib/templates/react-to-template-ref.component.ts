import { AfterViewInit, ChangeDetectionStrategy, Component, Input, TemplateRef, ViewChild } from '@angular/core';
import { ReactWrapperComponent } from '../react-wrapper/react-wrapper.component';

@Component({
  selector: 'react-to-template-ref',
  template: `
    <ng-template #tmpl let-props="props">
      @if (component) {
        <react-wrapper [component]="component" [props]="props" />
      }
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactWrapperComponent],
  standalone: true
})
export class ReactToTemplateRefComponent<C> implements AfterViewInit {
  @Input() public component!: any;
  @ViewChild('tmpl') public tmpl!: TemplateRef<{ props: C }> | null;
  private resolveTemplateRef!: (templateRef: TemplateRef<{ props: C }>) => any;
  templateRefPromise = new Promise<TemplateRef<{ props: C }>>((resolve) => {
    this.resolveTemplateRef = resolve;
  });

  ngAfterViewInit(): void {
    this.resolveTemplateRef(this.tmpl!);
  }
}
