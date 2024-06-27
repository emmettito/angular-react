import * as ng from "@angular/core";
import React, {
  ForwardedRef,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import ReactDOM from "react-dom";
import { Subscribable, Unsubscribable } from "rxjs";
import { InjectableReactContextToken } from "../injectable-react-context/react-context-token";
import { useInjectableReactContext } from "../injectable-react-context/use-injectable-react-context";
import { useInTreeCreateRoot } from "../use-in-tree-create-root/use-in-tree-create-root";
import { InTreeCreateRootToken } from "../use-in-tree-create-root/in-tree-create-root-token";
import { IsTopLevelReactToken } from "../templates/is-top-level-react-token";

function AngularWrapperWithModule(
  {
    name: ngComponentName,
    component: ngComponent,
    moduleRef: ngModuleRef,
    injector: ngInjector,
    inputs,
    events,
    outputs,
    children,
    serverFallback,
  }: {
    name?: string;
    component: any;
    moduleRef: ng.NgModuleRef<any>;
    injector: ng.Injector;
    inputs?: Record<string, any>;
    events?: Record<string, (ev: Event) => any>;
    outputs?: Record<string, (value: any) => any>;
    children?: any;
    serverFallback?: string;
  },
  ref: ForwardedRef<ng.ComponentRef<any> | null>
) {
  if (!ngComponent)
    throw new Error(
      "AngularWrapperWithModule needs a component but none was provided"
    );
  if (!ngModuleRef)
    throw new Error(
      "AngularWrapperWithModule needs a moduleRef but none was provided"
    );
  if (!ngInjector)
    throw new Error(
      "AngularWrapperWithModule needs an injector but none was provided"
    );

  const [renderedComponent, setRenderedComponent] =
    useState<ng.ComponentRef<any> | null>(null);
    const [renderedElement, setRenderedElement] =
    useState<HTMLElement | null>(null);

  useImperativeHandle(ref, () => renderedComponent!, [renderedComponent]);

  // TODO: for more compat see @angular/elements
  // https://github.com/angular/angular/blob/4332897baa2226ef246ee054fdd5254e3c129109/packages/elements/src/component-factory-strategy.ts#L200

  const hasChildren = !!children;
  const ngContentContainerEl = useMemo<HTMLDivElement | null>(() => {
    if (hasChildren) return document.createElement("div");
    return null;
  }, [hasChildren]);

  const inTreeCreateRoot = useInTreeCreateRoot();

  const injectedReactContext = useInjectableReactContext();

  /** This effect makes sure event listeners like 'click' are registered when the element is rendered */
  useEffect(() => {
    if (!events) return;
    if (!renderedElement) return;
    if (!ngInjector) return;

    const ngZone = ngInjector.get(ng.NgZone);

    const localEl = renderedElement;

    // sometimes the event handlers are executed in the Angular zone, sometimes they're not
    // we make sure they're always in the Angular zone
    const ngZonedEvents: typeof events = {};

    for (const eventKey in events) {
      const handler = events[eventKey];
      ngZonedEvents[eventKey] = (ev) => {
        ngZone.run(() => handler(ev));
      };
    }

    for (const event in ngZonedEvents) {
      localEl.addEventListener(event, ngZonedEvents[event]);
    }
    return () => {
      for (const event in ngZonedEvents) {
        localEl.removeEventListener(event, ngZonedEvents[event]);
      }
    };
  }, [renderedElement, events, ngInjector]);

  const elRef = useCallback<(node: HTMLElement) => void>(
    (node) => {
      if (node === null) return;
      setRenderedElement(node);
      const projectableNodes = ngContentContainerEl
        ? [[ngContentContainerEl]]
        : [];

      // extend the injector with our passed react context
      // so the nested react-wrappers can access it
      const injectorForComponent = ng.Injector.create({
        providers: [
          { provide: InjectableReactContextToken, useValue: injectedReactContext },
          { provide: InTreeCreateRootToken, useValue: inTreeCreateRoot.createRoot },
          { provide: IsTopLevelReactToken, useValue: false },
        ],
        parent: ngInjector,
      });

      const environmentInjector = ngInjector.get(ng.EnvironmentInjector);

      const componentRef = ng.createComponent(ngComponent, {
        environmentInjector,
        elementInjector: injectorForComponent,
        hostElement: node,
        projectableNodes,
      });

      const appRef = ngInjector.get(ng.ApplicationRef);
      appRef.attachView(componentRef.hostView);

      for (const [key, value] of Object.entries(inputs || {})) {
        componentRef.setInput(key, value);
      }
      setRenderedComponent(componentRef);
    },
    // inputs doesn't need to be a dep, this is already handled in the next useEffect
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ngComponent, ngModuleRef, ngInjector, injectedReactContext]
  );

  useEffect(() => {
    if (!renderedComponent) return;
    for (const [key, value] of Object.entries(inputs || {})) {
      renderedComponent.setInput(key, value);
    }
  }, [renderedComponent, inputs]);

  useEffect(() => {
    if (!renderedComponent) return;
    if (!outputs) return;
    if (!ngInjector) return;

    const ngZone = ngInjector.get(ng.NgZone);

    const subscriptions: Unsubscribable[] = [];

    for (const [key, handler] of Object.entries(outputs || {})) {
      const outputEmitter: Subscribable<any> = renderedComponent.instance[key];

      const subscription = outputEmitter.subscribe({
        next: (value: any) => {
          // like the events, we make sure the output handlers are called in the Angular zone
          ngZone.run(() => handler(value));
        },
      });
      subscriptions.push(subscription);
    }

    return () => {
      for (const subscription of subscriptions) {
        subscription.unsubscribe();
      }
    };
  }, [renderedComponent, outputs, ngInjector]);

  useEffect(() => {
    if (!renderedComponent) return;
    return () => {
      const node = renderedComponent.location.nativeElement;
      const nextSibling = node.nextSibling;
      const parentNode = node.parentNode;
      // destroy will remove node from parentNode,
      // but we want the host element to be managed by React
      renderedComponent!.destroy();
      // so we re-insert the node before the original nextSibling
      // if there's no parent node, React already removed the element
      parentNode?.insertBefore(node, nextSibling);
    };
  }, [renderedComponent]);

  let componentName = ngComponentName;
  if (!componentName) {
    componentName = ngComponent.ɵcmp?.selectors?.[0]?.[0];
    if (!componentName) {
      console.error(
        `Couldn't get component name from component`,
        ngComponent.ɵcmp
      );
      throw new Error(`Couldn't get component name from component`);
    } else if (!componentName.match(/^[a-z0-9-]+$/)) {
      console.error(
        `Couldn't use component selector as component name`,
        componentName
      );
      throw new Error(`Couldn't use component selector as component name`);
    }
  }

  return (
    <>
      {React.createElement(componentName, { ref: elRef }, serverFallback)}
      {ngContentContainerEl &&
        ReactDOM.createPortal(<>{children}</>, ngContentContainerEl)}
      {inTreeCreateRoot.portals}
    </>
  );
}

const AngularWrapperWithModuleForwardRef = forwardRef(AngularWrapperWithModule);

export { AngularWrapperWithModuleForwardRef as AngularWrapperWithModule };
