import * as _elemaudio_core from '@elemaudio/core';
import { EventEmitter } from '@elemaudio/core';

declare class OfflineRenderer extends EventEmitter {
    private _module;
    private _native;
    private _renderer;
    private _numInputChannels;
    private _numOutputChannels;
    private _blockSize;
    initialize(options: any): Promise<void>;
    render(...args: any[]): Promise<{
        nodesAdded: number;
        edgesAdded: number;
        propsWritten: number;
        elapsedTimeMs: number;
    }>;
    createRef(kind: any, props: any, children: any): (_elemaudio_core.NodeRepr_t | ((newProps: any) => Promise<any>))[];
    process(inputs: Array<Float32Array>, outputs: Array<Float32Array>): void;
    updateVirtualFileSystem(vfs: any): any;
    pruneVirtualFileSystem(): void;
    listVirtualFileSystem(): any;
    reset(): void;
    gc(): any;
    setCurrentTime(t: any): void;
    setCurrentTimeMs(t: any): void;
}

export { OfflineRenderer as default };
