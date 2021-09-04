function PGridPlugin() {
    let putSortableOptions;
    let startPosX = 0;
    function PGrid(sortable, el, options) {
        let that = this;
        this.defaults = {
            // swapClass: 'sortable-swap-highlight'
        };
        this._onDragHelper = function (e) {
            that._onDrag(e);
        }
    }

    PGrid.pluginName = 'pjsGrid'

    PGrid.prototype._onDrag = function (e) {
        let eX = e.clientX;
        let diff = eX - startPosX;
        let xIndent = putSortableOptions ? putSortableOptions.xIndent : this.options.xIndent;
        let currEl = e.target;
        if (Math.abs(diff) <= xIndent)
            return

        // update margin-left, data-indent, this.
        let style = window.getComputedStyle(currEl);
        let currMarginLeft = parseInt(style.marginLeft);
        let newMarginLeft, newIndent;
        if (xIndent > 0) {
            newMarginLeft = (currMarginLeft || 0) + (diff > 0 ? xIndent : -xIndent);
            newMarginLeft = newMarginLeft < 0 ? 0 : newMarginLeft;
        } else {
            newMarginLeft = 0;
        }
        if (currMarginLeft !== newMarginLeft) {
            currEl.style.marginLeft = newMarginLeft + 'px';
        }
        startPosX = eX;
    };

    PGrid.prototype.dragStarted = function({ dragEl, originalEvent }) {
        startPosX = originalEvent.clientX;
        window.addEventListener('drag', this._onDragHelper);
    };

    PGrid.prototype.drop = function ({dragEl}) {
        window.removeEventListener('drag', this._onDragHelper);

        let xIndent = putSortableOptions ? putSortableOptions.xIndent : this.options.xIndent;
        if (xIndent > 0) {
            let style = window.getComputedStyle(dragEl);
            let currMarginLeft = parseInt(style.marginLeft);
            newIndent = Math.floor(currMarginLeft / xIndent);
            dragEl.setAttribute('data-indent', newIndent);
        }
        putSortableOptions = null;
    };

    PGrid.prototype.dragOver = function ({putSortable}) {
        putSortableOptions = putSortable ? putSortable.options : null;
    }
    return PGrid;
}