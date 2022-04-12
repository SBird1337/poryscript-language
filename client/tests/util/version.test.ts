import { getNewestRelease } from '../../src/util/version';
import { GithubRelease } from '../../src/net';

import { expect } from 'chai';


describe('util/version/getNewestRelease', () => {
    it('checking semantic version sorting', () => {
        const releases : Array<GithubRelease> = [
            { name: "invalid.invalid.invalid", id: 0, published_at: undefined, assets: undefined },
            { name: "0.0.1", id: 0, published_at: undefined, assets: undefined },
            { name: "invalidSemanticVersion", id: 0, published_at: undefined, assets: undefined },
            { name: "1.0.0", id: 0, published_at: undefined, assets: undefined },
            { name: "1.1.1", id: 0, published_at: undefined, assets: undefined },
            { name: "1.1.0", id: 0, published_at: undefined, assets: undefined },
            { name: "1.1.2", id: 0, published_at: undefined, assets: undefined },
            { name: "1.3.1", id: 0, published_at: undefined, assets: undefined },
            { name: "1.3.0", id: 0, published_at: undefined, assets: undefined },
            { name: "1.3.2", id: 0, published_at: undefined, assets: undefined },
        ];

        const test0 = getNewestRelease("0", releases);
        expect(test0.name).to.equal("0.0.1");
        const test1 = getNewestRelease("1", releases);
        expect(test1.name).to.equal("1.3.2");
        const testInvalid = getNewestRelease("invalid", releases);
        expect(testInvalid).to.be.undefined;
    });
});