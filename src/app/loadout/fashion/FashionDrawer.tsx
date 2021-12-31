import { LoadoutParameters } from '@destinyitemmanager/dim-api-types';
import BungieImage from 'app/dim-ui/BungieImage';
import Sheet from 'app/dim-ui/Sheet';
import { t } from 'app/i18next-t';
import ConnectedInventoryItem from 'app/inventory/ConnectedInventoryItem';
import { DimItem, DimSocket, PluggableInventoryItemDefinition } from 'app/inventory/item-types';
import { allItemsSelector, unlockedPlugSetItemsSelector } from 'app/inventory/selectors';
import SocketDetails from 'app/item-popup/SocketDetails';
import { LockableBucketHashes } from 'app/loadout-builder/types';
import { DimLoadoutItem, Loadout } from 'app/loadout-drawer/loadout-types';
import { useD2Definitions } from 'app/manifest/selectors';
import { DEFAULT_SHADER } from 'app/search/d2-known-values';
import { AppIcon, clearIcon, rightArrowIcon } from 'app/shell/icons';
import { useIsPhonePortrait } from 'app/shell/selectors';
import { RootState } from 'app/store/types';
import { getSocketsByCategoryHash } from 'app/utils/socket-utils';
import { DestinyClass } from 'bungie-api-ts/destiny2';
import clsx from 'clsx';
import { PlugCategoryHashes, SocketCategoryHashes } from 'data/d2/generated-enums';
import produce from 'immer';
import _ from 'lodash';
import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { useSelector } from 'react-redux';
import { getDefaultPlugHash } from '../mod-utils';
import styles from './FashionDrawer.m.scss';

interface PickPlugState {
  item: DimItem;
  socket: DimSocket;
}

/** An editor for "Fashion" (shaders and ornaments) in a loadout */
export default function FashionDrawer({
  loadout,
  storeId,
  items,
  onModsByBucketUpdated,
  onClose,
}: {
  loadout: Loadout;
  storeId?: string;
  items: DimLoadoutItem[];
  onModsByBucketUpdated(modsByBucket: LoadoutParameters['modsByBucket']): void;
  onClose: () => void;
}) {
  const defs = useD2Definitions()!;
  const unlockedPlugs = useSelector((state: RootState) =>
    unlockedPlugSetItemsSelector(state, storeId)
  );
  const isPhonePortrait = useIsPhonePortrait();
  const [pickPlug, setPickPlug] = useState<PickPlugState>();

  const equippedIds = new Set([...loadout.items.filter((i) => i.equipped).map((i) => i.id)]);
  const armor = items.filter(
    (i) => equippedIds.has(i.id) && LockableBucketHashes.includes(i.bucket.hash)
  );

  const armorItemsByBucketHash: { [bucketHash: number]: DimItem } = _.keyBy(
    armor,
    (i) => i.bucket.hash
  );

  const [modsByBucket, setModsByBucket] = useState(loadout.parameters?.modsByBucket ?? {});
  const isShader = (h: number) =>
    defs.InventoryItem.get(h)?.plug?.plugCategoryHash === PlugCategoryHashes.Shader;
  const modHashes = Object.values(modsByBucket).flat();
  const shaders = modHashes.filter(isShader);
  const ornaments = modHashes.filter((h) => !isShader(h));

  // TODO: if they add an armor piece that can't slot the selected mods (ornaments), clear them

  const header = (
    <>
      <h1>{t('FashionDrawer.Title')}</h1>
    </>
  );

  const footer = ({ onClose }: { onClose(): void }) => (
    <>
      <button
        type="button"
        className="dim-button"
        onClick={() => {
          onModsByBucketUpdated(modsByBucket);
          onClose();
        }}
      >
        {t('FashionDrawer.Accept')}
      </button>
    </>
  );

  const handlePlugSelected = ({
    item,
    socket,
    plugHash,
  }: {
    item: DimItem;
    socket: DimSocket;
    plugHash: number;
  }) => {
    setModsByBucket((modsByBucket) => {
      // Clear out existing selections for this socket.
      const existingMods = (modsByBucket[item.bucket.hash] ?? []).filter(
        (mod) => !socket.plugSet?.plugs.some((p) => p.plugDef.hash === mod)
      );

      return {
        ...modsByBucket,
        // Add in the new mod
        [item.bucket.hash]: [...existingMods, plugHash],
      };
    });
  };

  const handleUseEquipped = () => {
    const newModsByBucket = _.mapValues(armorItemsByBucketHash, (item) => {
      const cosmeticSockets = item.sockets
        ? getSocketsByCategoryHash(item.sockets, SocketCategoryHashes.ArmorCosmetics)
        : [];
      return _.compact(cosmeticSockets.map((s) => s.plugged?.plugDef.hash));
    });

    setModsByBucket(newModsByBucket);
  };

  const handleSyncShader = () => {
    const shaders = Object.values(modsByBucket).flat().filter(isShader);

    const groupedShaders = _.groupBy(shaders, (h) => h);
    const mostCommonShaders = _.maxBy(Object.values(groupedShaders), (shaders) => shaders.length);
    if (!mostCommonShaders) {
      return;
    }

    setModsByBucket((modsByBucket) =>
      Object.fromEntries(
        LockableBucketHashes.map((bucketHash) => [
          bucketHash,
          [...(modsByBucket[bucketHash] ?? []).filter((h) => !isShader(h)), mostCommonShaders[0]],
        ])
      )
    );
  };

  const handleSyncOrnament = () => {
    const isShader = (h: number) =>
      defs.InventoryItem.get(h)?.plug?.plugCategoryHash === PlugCategoryHashes.Shader;
    const ornaments = Object.values(modsByBucket)
      .flat()
      .filter((h) => !isShader(h));

    const groupedOrnaments = _.groupBy(ornaments, (h) => {
      const collectibleHash = defs.InventoryItem.get(h)?.collectibleHash;
      return collectibleHash && defs.Collectible.get(collectibleHash)?.parentNodeHashes[0];
    });
    delete groupedOrnaments['undefined'];
    const mostCommonOrnamentSet = _.maxBy(
      Object.entries(groupedOrnaments),
      ([_presentationHash, ornaments]) => ornaments.length
    );
    if (!mostCommonOrnamentSet) {
      return;
    }

    const set = defs.PresentationNode.get(
      parseInt(mostCommonOrnamentSet[0], 10)
    ).children.collectibles.map((c) => defs.Collectible.get(c.collectibleHash).itemHash);

    setModsByBucket((modsByBucket) =>
      Object.fromEntries(
        LockableBucketHashes.map((bucketHash, i) => {
          const ornament = set[i];
          if (unlockedPlugs.has(ornament)) {
            const modsWithoutShaders = (modsByBucket[bucketHash] ?? []).filter((h) => isShader(h));
            const mods = [...modsWithoutShaders, ornament];
            return [bucketHash, mods];
          }
          return [bucketHash, modsByBucket[bucketHash]];
        })
      )
    );
  };

  const handleClearType = (shaders: boolean) => {
    setModsByBucket(
      produce((modsByBucket) => {
        for (const bucket in modsByBucket) {
          const mods = modsByBucket[bucket];
          const modsWithoutShaders = mods.filter((h) => (shaders ? !isShader(h) : isShader(h)));
          if (modsWithoutShaders.length === 0) {
            delete modsByBucket[bucket];
          } else {
            modsByBucket[bucket] = modsWithoutShaders;
          }
        }
      })
    );
  };

  const leftButtons = (
    <>
      <div>
        <button
          type="button"
          className="dim-button"
          onClick={handleUseEquipped}
          disabled={_.isEmpty(armorItemsByBucketHash)}
        >
          {t('FashionDrawer.UseEquipped')}
        </button>
      </div>
      <div>
        <button
          type="button"
          className="dim-button"
          onClick={handleSyncShader}
          disabled={shaders.length === 0}
        >
          {isPhonePortrait ? t('FashionDrawer.SyncShaders') : t('FashionDrawer.Sync')}{' '}
          <AppIcon icon={rightArrowIcon} />
        </button>
      </div>
      <div>
        <button
          type="button"
          className="dim-button"
          onClick={handleSyncOrnament}
          disabled={ornaments.length === 0}
        >
          {isPhonePortrait ? t('FashionDrawer.SyncOrnaments') : t('FashionDrawer.Sync')}{' '}
          <AppIcon icon={rightArrowIcon} />
        </button>
      </div>
    </>
  );

  const rightButtons = (
    <>
      <div>
        <button
          type="button"
          className="dim-button"
          onClick={() => setModsByBucket({})}
          disabled={_.isEmpty(modsByBucket)}
        >
          {t('FashionDrawer.Reset')}
        </button>
      </div>
      <div>
        <button
          type="button"
          className="dim-button"
          onClick={() => handleClearType(true)}
          disabled={shaders.length === 0}
        >
          <AppIcon icon={clearIcon} /> {isPhonePortrait && t('FashionDrawer.ClearShaders')}
        </button>
      </div>
      <div>
        <button
          type="button"
          className="dim-button"
          onClick={() => handleClearType(false)}
          disabled={ornaments.length === 0}
        >
          <AppIcon icon={clearIcon} /> {isPhonePortrait && t('FashionDrawer.ClearOrnaments')}
        </button>
      </div>
    </>
  );

  // TODO: We should plumb down the store that this loadout is being edited for here, to determine class type
  const classType =
    loadout.classType !== DestinyClass.Unknown
      ? loadout.classType
      : armor.length > 0
      ? armor[0].classType
      : // This is a failure, it won't display right
        DestinyClass.Unknown;

  return (
    <Sheet onClose={onClose} header={header} footer={footer} sheetClassName={styles.sheet}>
      <div className={styles.items}>
        {!isPhonePortrait && <div className={styles.verticalButtons}>{leftButtons}</div>}
        {LockableBucketHashes.map((bucketHash) => (
          <FashionItem
            key={bucketHash}
            classType={classType}
            bucketHash={bucketHash}
            item={armorItemsByBucketHash[bucketHash]}
            mods={modsByBucket[bucketHash]}
            onPickPlug={setPickPlug}
          />
        ))}
        {!isPhonePortrait && (
          <div className={clsx(styles.verticalButtons, styles.right)}>{rightButtons}</div>
        )}
      </div>
      {isPhonePortrait && (
        <div className={styles.buttons}>
          {leftButtons}
          {rightButtons}
        </div>
      )}
      {pickPlug &&
        ReactDOM.createPortal(
          <SocketDetails
            item={pickPlug.item}
            allowInsertPlug={false}
            socket={pickPlug.socket}
            onClose={() => setPickPlug(undefined)}
            onPlugSelected={handlePlugSelected}
          />,
          document.body
        )}
    </Sheet>
  );
}

function FashionItem({
  item,
  classType,
  bucketHash,
  mods,
  onPickPlug,
}: {
  item?: DimLoadoutItem;
  classType: DestinyClass;
  bucketHash: number;
  mods?: number[];
  onPickPlug(params: PickPlugState): void;
}) {
  const defs = useD2Definitions()!;
  const allItems = useSelector(allItemsSelector);

  // TODO: categorize mods by what socket they'd fit into?
  // TODO: replace default plug w/ selected plug?

  // TODO: is this really the best way to do this? we just default to the equipped item, but that may be an exotic
  const exampleItem =
    item ??
    allItems.find(
      (i) => i.bucket.hash === bucketHash && i.tier === 'Legendary' && i.classType === classType
    );

  if (!exampleItem) {
    return null;
  }

  const cosmeticSockets = getSocketsByCategoryHash(
    exampleItem.sockets!,
    SocketCategoryHashes.ArmorCosmetics
  );

  // TODO: maybe instead, partition by shader/ornament and just grey out if it won't work?

  const plugsBySocketIndex: {
    [socketIndex: number]: PluggableInventoryItemDefinition | undefined;
  } = {};
  for (const socket of cosmeticSockets) {
    const matchingMod = mods?.find((mod) =>
      socket.plugSet?.plugs.some((plug) => plug.plugDef.hash === mod)
    );
    if (matchingMod) {
      plugsBySocketIndex[socket.socketIndex] = defs.InventoryItem.get(
        matchingMod
      ) as PluggableInventoryItemDefinition;
    } else {
      const defaultHash = defs.SocketType.get(
        socket.socketDefinition.socketTypeHash
      ).plugWhitelist.some((pw) => pw.categoryHash === PlugCategoryHashes.Shader)
        ? DEFAULT_SHADER
        : getDefaultPlugHash(socket, defs);
      if (defaultHash) {
        plugsBySocketIndex[socket.socketIndex] = defs.InventoryItem.get(
          defaultHash
        ) as PluggableInventoryItemDefinition;
      }
    }
  }

  // TODO: placeholder should have bucket-specific icon

  return (
    <div className={styles.item}>
      <div className={clsx({ [styles.placeholder]: !item })}>
        <ConnectedInventoryItem item={exampleItem} />
      </div>
      {cosmeticSockets.map((socket) => {
        const plug = plugsBySocketIndex[socket.socketIndex];
        return (
          plug && (
            <div
              key={socket.socketIndex}
              className={styles.socket}
              onClick={() => onPickPlug({ item: exampleItem, socket })}
            >
              <BungieImage src={plug.displayProperties.icon} />
            </div>
          )
        );
      })}
    </div>
  );
}
